// One moment of play: brief -> play (ball travelling, you scan) -> decide (slow
// motion, you tap) -> outcome (the truth is revealed, the ball goes) -> review.
// Pure game state: no three.js, no DOM. The renderer and HUD read from it.

import { clamp, dist, type V2 } from "../core/math";
import { evalCarry, evalPass, evalSpace, evaluateAll, gradeChoice, type Decision, type OptionEval } from "../eval/evaluate";
import { DEFAULT_PARAMS, type ModelParams } from "../eval/model";
import { Vision } from "../sim/memory";
import { ballAt, buildScenario, posAt, type Entity, type Scenario, type ScenarioSpec } from "../sim/scenario";

export type Phase = "brief" | "play" | "decide" | "outcome" | "review";
export type Outcome = "success" | "intercepted" | "tackled" | "lost";

export interface Tuning {
  /** Real seconds you get to decide in a timed moment. */
  decideWindow: number;
  /** Game speed while you decide in a timed moment. */
  slowMotion: number;
  /** Seconds the brief stays up before play starts on its own. */
  briefTime: number;
  model: ModelParams;
}

export const DEFAULT_TUNING: Tuning = { decideWindow: 1.5, slowMotion: 0.25, briefTime: 2.4, model: DEFAULT_PARAMS };

export interface MomentResult {
  sceneId: string;
  skill: string;
  title: string;
  choice: OptionEval | null;
  best: OptionEval;
  decision: Decision;
  grade: number;
  correct: boolean;
  /** Right answer without having seen the player it depended on. */
  blind: boolean;
  heavyTouch: boolean;
  timeout: boolean;
  reactionMs: number | null;
  scans: number;
  lastScanBeforeArrivalMs: number | null;
  inputToFrameMs: number | null;
  outcome: Outcome;
  /** Entities that were drawn as ghosts when you decided, with where you thought they were. */
  ghostsAtDecision: { id: string; x: number; y: number }[];
}

/** Replaces an entity's scripted path from t0: stand at `from`, move to `to` over [move, t1]. */
interface Override {
  from: V2;
  to: V2;
  t0: number;
  move: number;
  t1: number;
  /** Keep moving this way after arriving, m/s. */
  after?: V2;
}

interface BallPlan {
  from: V2;
  to: V2;
  t0: number;
  t1: number;
  /** Who has it after it arrives (follows them). */
  holder: string | null;
  /** Scenario time the holder actually reaches it; until then it rests where it stopped. */
  holdFrom: number;
  lofted: boolean;
}

export interface Tap {
  /** Pitch point under the finger. */
  point: V2;
  /** Teammate the tap snapped to, if any. */
  mateId: string | null;
  /** Clock time of the input event. */
  at: number;
}

export class Moment {
  readonly scenario: Scenario;
  readonly vision: Vision;
  phase: Phase = "brief";
  /** Scenario time. */
  tau = 0;
  timeScale = 0;
  /** Clock times. */
  phaseStart = 0;
  decideOpenedAt = 0;
  outcomeStart = 0;
  heavyTouch = false;
  pendingTap: Tap | null = null;
  /** Set by the game once the frame answering the tap is on screen; scoring waits for it. */
  tapReady = false;
  commitTau = 0;
  result: MomentResult | null = null;
  inputToFrameMs: number | null = null;
  private readonly overrides = new Map<string, Override>();
  ball: BallPlan | null = null;
  outcomeEnd = 0;
  /** Seen-state of every entity at the decision (for the reveal). */
  readonly ghostAtDecision = new Map<string, V2>();
  /** Set when the brief should end early (the player tapped "go"). */
  skipBrief = false;

  constructor(
    readonly spec: ScenarioSpec,
    readonly tuning: Tuning = DEFAULT_TUNING,
  ) {
    this.scenario = buildScenario(spec);
    this.vision = new Vision(this.scenario);
    this.vision.seedAll(0);
  }

  get timed(): boolean {
    return this.spec.timed;
  }

  /** Seconds left to decide (Infinity when untimed). */
  timeLeft(now: number): number {
    if (this.phase !== "decide") return Infinity;
    if (!this.timed) return Infinity;
    return Math.max(0, this.tuning.decideWindow - (now - this.decideOpenedAt));
  }

  start(now: number): void {
    this.phase = "brief";
    this.phaseStart = now;
    this.timeScale = 0;
  }

  private enter(phase: Phase, now: number): void {
    this.phase = phase;
    this.phaseStart = now;
  }

  /** Returns events that happened this frame, for sound and effects. */
  update(now: number, dt: number): string[] {
    const events: string[] = [];
    if (this.phase === "brief") {
      if (this.skipBrief || now - this.phaseStart >= this.tuning.briefTime) {
        this.enter("play", now);
        this.timeScale = 1;
        events.push("play");
      }
      return events;
    }
    if (this.phase === "outcome") this.timeScale = Math.min(1, this.timeScale + dt * 4);
    const before = this.tau;
    this.tau += dt * this.timeScale;
    const s = this.scenario;
    if (before < this.spec.kickAt && this.tau >= this.spec.kickAt) events.push("kick");

    if (this.phase === "play") {
      if (this.tau >= s.arrival) {
        this.tau = s.arrival;
        this.vision.step(this.tau);
        this.heavyTouch = this.vision.headTurnedAtArrival();
        this.enter("decide", now);
        this.decideOpenedAt = now;
        this.timeScale = this.timed ? this.tuning.slowMotion : 0;
        events.push(this.heavyTouch ? "heavy-touch" : "touch");
      } else {
        this.vision.step(this.tau);
      }
    } else if (this.phase === "decide") {
      this.vision.step(this.tau);
      if (this.pendingTap) {
        if (this.tapReady) {
          this.resolve(this.pendingTap, now);
          events.push(this.result!.correct ? "commit-good" : "commit");
        }
      } else if (this.timed && now - this.decideOpenedAt >= this.tuning.decideWindow) {
        this.resolve(null, now);
        events.push("timeout");
      }
    } else if (this.phase === "outcome") {
      if (this.ball && before < this.ball.t1 && this.tau >= this.ball.t1) events.push(this.result!.outcome === "success" ? "arrive" : "cut");
      if (this.tau >= this.outcomeEnd) {
        this.enter("review", now);
        this.timeScale = 0;
        events.push("review");
      }
    }
    return events;
  }

  /** Called by input on pointerdown; the decision is resolved on the next update. */
  tap(t: Tap): boolean {
    if (this.phase !== "decide" || this.pendingTap) return false;
    if (t.at < this.decideOpenedAt) return false;
    this.pendingTap = t;
    this.tapReady = false;
    return true;
  }

  scan(side: 1 | -1, now: number): boolean {
    if (this.phase !== "play") return false;
    void now;
    return this.vision.startScan(side, this.tau);
  }

  /** The option a tap stands for. */
  optionFor(tap: Tap, extraDelay: number): OptionEval {
    const s = this.scenario;
    const params = this.tuning.model;
    const t = this.tau;
    if (tap.mateId) return evalPass(s, t, s.byId.get(tap.mateId)!, { params, extraDelay });
    const me = posAt(s.you, t);
    if (dist(me, tap.point) <= 12) return evalCarry(s, t, tap.point, "carry:tap", { params, extraDelay });
    return evalSpace(s, t, tap.point, "space:tap", "Ball into space", { params, extraDelay });
  }

  private resolve(tap: Tap | null, now: number): void {
    const s = this.scenario;
    const params = this.tuning.model;
    const extraDelay = this.heavyTouch ? params.heavyTouch : 0;
    this.commitTau = this.tau;
    // What was on screen at the tap: players drawn as ghosts then are "where you thought".
    this.ghostAtDecision.clear();
    for (const e of s.all) {
      if (e === s.you) continue;
      const m = this.vision.memory.get(e.id);
      if (m && !m.live) this.ghostAtDecision.set(e.id, { x: m.x, y: m.y });
    }
    const decision = evaluateAll(s, this.tau, { params, extraDelay });
    const choice = tap ? this.optionFor(tap, extraDelay) : null;
    const graded = choice ? gradeChoice(decision, choice, params) : { grade: 0, correct: false, gap: Infinity };
    // A right answer you could not have known is a guess: it counts, but not fully.
    const key = this.spec.keyEntity;
    const keyAge = key ? this.tau - (this.vision.memory.get(key)?.t ?? -Infinity) : 0;
    const blind = !!choice && graded.correct && this.spec.scanRequired && keyAge > 1.2;
    const grade = blind ? Math.min(graded.grade, 70) : graded.grade;
    const lastScan = this.vision.lastScanBeforeArrival();
    const outcome: Outcome = !choice ? "lost" : choice.succeeds ? "success" : choice.option.kind === "carry" ? "tackled" : "intercepted";
    this.result = {
      sceneId: this.spec.id,
      skill: this.spec.skill,
      title: this.spec.title,
      choice,
      best: decision.best,
      decision,
      grade,
      correct: graded.correct,
      blind,
      heavyTouch: this.heavyTouch,
      timeout: !choice,
      reactionMs: tap ? Math.max(0, Math.round((tap.at - this.decideOpenedAt) * 1000)) : null,
      scans: this.vision.scansBeforeArrival(),
      lastScanBeforeArrivalMs: lastScan === null ? null : Math.round(lastScan * 1000),
      inputToFrameMs: this.inputToFrameMs,
      outcome,
      ghostsAtDecision: [...this.ghostAtDecision].map(([id, p]) => ({ id, x: p.x, y: p.y })),
    };
    this.planOutcome(choice);
    this.enter("outcome", now);
    this.outcomeStart = now;
    this.timeScale = Math.max(this.timeScale, 0.25);
  }

  private planOutcome(choice: OptionEval | null): void {
    const s = this.scenario;
    const params = this.tuning.model;
    const t = this.tau;
    const me = posAt(s.you, t);
    this.overrides.set(s.you.id, { from: me, to: me, t0: t, move: t, t1: t });
    if (!choice) {
      // Too late: the nearest defender arrives and takes it.
      let near: Entity | null = null;
      let best = Infinity;
      for (const o of s.opps) {
        const d = dist(posAt(o, t), me);
        if (d < best) {
          best = d;
          near = o;
        }
      }
      const arrive = near ? t + params.reaction + Math.max(0, best - 1) / params.defenderSpeed : t + 0.6;
      if (near) this.overrides.set(near.id, { from: posAt(near, t + params.reaction), to: me, t0: t + params.reaction, move: t + params.reaction, t1: arrive, after: { x: -3, y: 0 } });
      this.ball = { from: me, to: me, t0: arrive, t1: arrive, holder: near?.id ?? null, holdFrom: arrive, lofted: false };
      this.outcomeEnd = arrive + 1.1;
      return;
    }
    const kind = choice.option.kind;
    const start = t + choice.release;
    const target = choice.option.target;
    const loss = choice.loss;
    // The ball stops where it is won (on the line, or at the spot for a lost footrace).
    const end = loss ? loss.at : target;
    const t1 = start + dist(me, end) / choice.speed;
    // You stop where you received it; on a carry you turn, then go.
    if (kind === "carry") this.overrides.set(s.you.id, { from: me, to: end, t0: t, move: start, t1 });
    if (loss) {
      const thief = s.byId.get(loss.id)!;
      const t0 = t + params.reaction;
      const wins = Math.max(t + loss.time, t0 + 0.15);
      // He reacts, runs to where he wins it, then carries it away.
      this.overrides.set(thief.id, { from: posAt(thief, t0), to: end, t0, move: t0, t1: wins, after: { x: -4, y: 0 } });
      this.ball = { from: me, to: end, t0: start, t1, holder: thief.id, holdFrom: wins, lofted: false };
      this.outcomeEnd = Math.max(t1, wins) + 1.2;
      return;
    }
    let ballEnd = t1;
    if (kind === "space" && choice.option.mateId) {
      const id = choice.option.mateId;
      ballEnd = t + choice.travel;
      this.overrides.set(id, { from: posAt(s.byId.get(id)!, t), to: target, t0: t, move: t, t1: ballEnd, after: { x: 3, y: 0 } });
    }
    const holder = kind === "carry" ? s.you.id : choice.option.mateId ?? null;
    this.ball = { from: me, to: target, t0: start, t1: ballEnd, holder, holdFrom: ballEnd, lofted: false };
    this.outcomeEnd = ballEnd + 0.9;
  }

  /** Where an entity really is now (scenario path, or the outcome's override). */
  truePos(e: Entity, tau: number, out: V2): V2 {
    const o = this.overrides.get(e.id);
    if (!o || tau < o.t0) return posAt(e, tau, out);
    const k = o.t1 > o.move ? clamp((tau - o.move) / (o.t1 - o.move), 0, 1) : tau >= o.move ? 1 : 0;
    out.x = o.from.x + (o.to.x - o.from.x) * k;
    out.y = o.from.y + (o.to.y - o.from.y) * k;
    if (tau > o.t1 && o.after) {
      const extra = Math.min(tau - o.t1, 1.5);
      out.x += o.after.x * extra;
      out.y += o.after.y * extra;
    }
    return out;
  }

  /** Ball position (pitch metres) and height. */
  ballPos(tau: number, out: V2 & { h: number }): V2 & { h: number } {
    out.h = 0;
    const b = this.ball;
    if (!b) return ballAt(this.scenario, tau, out) as V2 & { h: number };
    if (tau < b.t0) return this.truePos(this.scenario.you, tau, out) as V2 & { h: number };
    if (tau < b.t1) {
      // On a carry the ball stays at your feet as you go.
      if (b.holder === this.scenario.you.id) return this.truePos(this.scenario.you, tau, out) as V2 & { h: number };
      const k = (tau - b.t0) / (b.t1 - b.t0);
      out.x = b.from.x + (b.to.x - b.from.x) * k;
      out.y = b.from.y + (b.to.y - b.from.y) * k;
      return out;
    }
    if (b.holder && tau >= b.holdFrom) return this.truePos(this.scenario.byId.get(b.holder)!, tau, out) as V2 & { h: number };
    out.x = b.to.x;
    out.y = b.to.y;
    return out;
  }
}
