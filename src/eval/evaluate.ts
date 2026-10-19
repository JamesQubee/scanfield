// Scores every option at the moment you decide, from true positions.
//
// Pass model (inspired by physics-based pass probability models such as Spearman's):
// the ball travels along a straight line; each defender reacts, then runs flat out
// to the point of the line he can reach soonest. The time margin between the ball
// and the defender at that point decides the interception, softened by a sigmoid
// for the probability shown on the board. A carry is the same race with a slow "ball".
// The outcome animation uses the hard rule (margin < 0 means cut out), so what the
// player sees never contradicts the board.

import { clamp, clampToPitch, dist, sigmoid, type V2 } from "../core/math";
import { posAt, type Entity, type Scenario } from "../sim/scenario";
import { DEFAULT_PARAMS, type ModelParams } from "./model";
import { oppValueAt, valueAt } from "./value";

export type OptionKind = "pass" | "setback" | "carry" | "space";

export interface Option {
  kind: OptionKind;
  /** "pass:<id>", "setback", "carry:<deg>", "carry:tap", "space:<id>", "space:tap" */
  id: string;
  label: string;
  /** Where the ball is aimed (for passes, where the teammate is when it gets there). */
  target: V2;
  mateId?: string;
}

export interface Threat {
  id: string;
  /** Seconds the defender has to spare (< 0: he gets there first). */
  margin: number;
  /** Where on the line that happens. */
  at: V2;
}

export interface OptionEval {
  option: Option;
  /** Probability the ball gets there. */
  p: number;
  /** Expected value: what we gain if it works minus what we give away if it doesn't. */
  ev: number;
  /** Pressure on whoever has the ball at the target, 0..1. */
  press: number;
  value: number;
  /** The defender closest to stopping it. */
  threat: Threat | null;
  /** Deterministic outcome used for the animation. */
  succeeds: boolean;
  /** Seconds after the decision until the ball reaches the target. */
  travel: number;
  /** Ball (or carrier) speed along the line, m/s. */
  speed: number;
  /** Time before the ball leaves your foot, s. */
  release: number;
}

export interface Decision {
  /** Scenario time at the decision. */
  t: number;
  ballAt: V2;
  candidates: OptionEval[];
  best: OptionEval;
}

export interface Grade {
  grade: number;
  correct: boolean;
  gap: number;
}

const scratch: V2 = { x: 0, y: 0 };

function defenderTime(d: V2, p: V2, reach: number, params: ModelParams): number {
  return params.reaction + Math.max(0, dist(d, p) - reach) / params.defenderSpeed;
}

/** The race along the line from `from` to `to`. Returns the most dangerous defender. */
function race(
  scenario: Scenario,
  t: number,
  from: V2,
  to: V2,
  speed: number,
  release: number,
  reach: number,
  params: ModelParams,
  shield = 0,
): { pAll: number; threat: Threat | null } {
  const len = dist(from, to);
  const steps = Math.max(1, Math.ceil(len / 0.5));
  const first = len > 0 ? Math.min(shield / len, 1) : 0;
  let pAll = 1;
  let threat: Threat | null = null;
  for (const opp of scenario.opps) {
    const d = posAt(opp, t, { x: 0, y: 0 });
    let best = Infinity;
    let bestS = 0;
    for (let i = 0; i <= steps; i++) {
      const s = first + ((1 - first) * i) / steps;
      scratch.x = from.x + (to.x - from.x) * s;
      scratch.y = from.y + (to.y - from.y) * s;
      const margin = defenderTime(d, scratch, reach, params) - (release + (s * len) / speed);
      if (margin < best) {
        best = margin;
        bestS = s;
      }
    }
    pAll *= 1 - sigmoid(-best / params.raceSoftness);
    if (!threat || best < threat.margin) {
      threat = { id: opp.id, margin: best, at: { x: from.x + (to.x - from.x) * bestS, y: from.y + (to.y - from.y) * bestS } };
    }
  }
  return { pAll, threat };
}

/** Pressure on whoever has the ball at `at`, `arrive` seconds after the decision. */
function pressureAt(scenario: Scenario, t: number, at: V2, arrive: number, params: ModelParams): number {
  let gap = Infinity;
  for (const opp of scenario.opps) {
    const d = posAt(opp, t, scratch);
    gap = Math.min(gap, defenderTime(d, at, params.tackleReach, params) - arrive);
  }
  return sigmoid((0.2 - gap) / 0.2);
}

function finish(
  params: ModelParams,
  option: Option,
  ballAt: V2,
  r: { pAll: number; threat: Threat | null },
  travel: number,
  press: number,
  speed: number,
  release: number,
  extraP = 1,
): OptionEval {
  const p = r.pAll * extraP;
  const value = valueAt(option.target);
  const loss = r.threat && r.threat.margin < 0.25 ? r.threat.at : ballAt;
  // Receiving under pressure is worth less, but it is still the ball in that spot.
  const ev = p * value * (1 - 0.25 * press) - (1 - p) * (oppValueAt(loss) + params.turnoverCost);
  const succeeds = (r.threat ? r.threat.margin >= 0 : true) && extraP >= 0.5;
  return { option, p, ev, press, value, threat: r.threat, succeeds, travel, speed, release };
}

export interface EvalOptions {
  params?: ModelParams;
  /** Extra seconds before release (heavy touch). */
  extraDelay?: number;
}

export function passSpeedFor(len: number, params: ModelParams): number {
  return Math.min(params.passSpeedMax, params.passSpeed + params.passSpeedPerM * len);
}

export function evalPass(scenario: Scenario, t: number, mate: Entity, o: EvalOptions = {}): OptionEval {
  const params = o.params ?? DEFAULT_PARAMS;
  const release = params.passRelease + (o.extraDelay ?? 0);
  const ballAt = posAt(scenario.you, t);
  // Aim where the teammate will be when the ball gets there.
  const target = posAt(mate, t);
  let travel = release;
  let speed = params.passSpeed;
  for (let i = 0; i < 4; i++) {
    const len = dist(ballAt, target);
    speed = passSpeedFor(len, params);
    travel = release + len / speed;
    posAt(mate, t + travel, target);
  }
  const setback = mate.id === scenario.passer.id;
  const option: Option = {
    kind: setback ? "setback" : "pass",
    id: setback ? "setback" : `pass:${mate.id}`,
    label: setback ? `Set it back to ${mate.number}` : `Pass to ${mate.number}`,
    target,
    mateId: mate.id,
  };
  const r = race(scenario, t, ballAt, target, speed, release, params.interceptReach, params, params.passShield);
  const press = pressureAt(scenario, t, target, travel, params);
  return finish(params, option, ballAt, r, travel, press, speed, release);
}

export function evalCarry(scenario: Scenario, t: number, toward: V2, id: string, o: EvalOptions = {}, length?: number): OptionEval {
  const params = o.params ?? DEFAULT_PARAMS;
  const release = params.turnRelease + (o.extraDelay ?? 0);
  const ballAt = posAt(scenario.you, t);
  const dx = toward.x - ballAt.x;
  const dy = toward.y - ballAt.y;
  const d = Math.hypot(dx, dy) || 1;
  const len = length ?? params.carryLength;
  const target = clampToPitch({ x: ballAt.x + (dx / d) * len, y: ballAt.y + (dy / d) * len });
  const travel = release + dist(ballAt, target) / params.carrySpeed;
  const option: Option = { kind: "carry", id, label: dx > 0 ? "Turn and carry" : "Carry", target };
  // Defenders already right on top of you get a head start: the carry starts at your feet.
  const r = race(scenario, t, ballAt, target, params.carrySpeed, release, params.tackleReach, params);
  const press = pressureAt(scenario, t, target, travel, params);
  return finish(params, option, ballAt, r, travel, press, params.carrySpeed, release);
}

/** A ball into space: the line race, then a footrace at the spot between our runner and theirs. */
export function evalSpace(scenario: Scenario, t: number, at: V2, id: string, label: string, o: EvalOptions = {}): OptionEval {
  const params = o.params ?? DEFAULT_PARAMS;
  const release = params.passRelease + (o.extraDelay ?? 0);
  const ballAt = posAt(scenario.you, t);
  const target = clampToPitch({ x: at.x, y: at.y });
  const speed = passSpeedFor(dist(ballAt, target), params);
  const travel = release + dist(ballAt, target) / speed;
  let runner = Infinity;
  let runnerId: string | undefined;
  for (const m of scenario.mates) {
    // A teammate whose run already takes him there needs no extra time.
    const scripted = dist(posAt(m, t + travel, scratch), target);
    const fromNow = 0.2 + Math.max(0, dist(posAt(m, t, scratch), target) - 1) / params.runnerSpeed;
    const time = scripted <= 2.5 ? travel : Math.max(travel, fromNow);
    if (time < runner) {
      runner = time;
      runnerId = m.id;
    }
  }
  let defender = Infinity;
  for (const opp of scenario.opps) defender = Math.min(defender, defenderTime(posAt(opp, t, scratch), target, params.interceptReach, params));
  const footrace = sigmoid((defender - runner) / 0.15);
  const option: Option = { kind: "space", id, label, target, ...(runnerId ? { mateId: runnerId } : {}) };
  const r = race(scenario, t, ballAt, target, speed, release, params.interceptReach, params, params.passShield);
  const press = pressureAt(scenario, t, target, runner, params);
  return finish(params, option, ballAt, r, Math.max(travel, runner), press, speed, release, footrace);
}

const CARRY_DIRECTIONS = [-90, -60, -30, 0, 30, 60, 90];

/** Every option the board compares against: all passes, the set-back, carries in 7 directions, named spaces. */
export function evaluateAll(scenario: Scenario, t: number, o: EvalOptions = {}): Decision {
  const ballAt = posAt(scenario.you, t);
  const candidates: OptionEval[] = [];
  for (const m of scenario.mates) candidates.push(evalPass(scenario, t, m, o));
  for (const deg of CARRY_DIRECTIONS) {
    const a = (deg * Math.PI) / 180;
    candidates.push(evalCarry(scenario, t, { x: ballAt.x + Math.cos(a), y: ballAt.y + Math.sin(a) }, `carry:${deg}`, o));
  }
  for (const s of scenario.spec.spaces ?? []) {
    candidates.push(evalSpace(scenario, t, { x: s.at[0], y: s.at[1] }, `space:${s.id}`, s.label, o));
  }
  let best = candidates[0]!;
  for (const c of candidates) if (c.ev > best.ev) best = c;
  return { t, ballAt, candidates, best };
}

export function gradeChoice(decision: Decision, choice: OptionEval, params: ModelParams = DEFAULT_PARAMS): Grade {
  const bestEv = Math.max(decision.best.ev, choice.ev);
  const gap = bestEv - choice.ev;
  const correct = gap <= Math.max(params.tieAbs, params.tieRel * Math.abs(bestEv));
  let grade = correct ? 100 : Math.round(100 * clamp(1 - gap / params.gradeScale, 0, 0.95));
  // A pass that gets cut out is never a decent mark, whatever the model's margins say.
  if (!choice.succeeds) grade = Math.min(grade, params.failedCap);
  return { grade, correct, gap };
}

/** Does an option id match the scenario author's intended best ("carry" matches any carry)? */
export function matchesIntended(intended: string, id: string): boolean {
  if (intended === "carry") return id.startsWith("carry:");
  return intended === id;
}
