// The game controller: owns the frame loop, input, the current moment and the
// drill. Input handlers do O(1) work and leave scoring to the next frame, so the
// response to a tap is drawn in the first frame after the finger lands.

import { Clock } from "../core/clock";
import type { V2 } from "../core/math";
import { groundPoint, snapTo } from "../input/pick";
import { CameraRig, type Shot } from "../render/cameraRig";
import { Stage } from "../render/stage";
import { SKILLS, type ScenarioSpec } from "../sim/scenario";
import { play as sfx, crowdOn } from "../platform/audio";
import { buzz } from "../platform/haptics";
import { CoachBoard, verdict } from "../ui/coachBoard";
import { Hud } from "../ui/hud";
import { Perf } from "../ui/perfHud";
import { DEFAULT_TUNING, Moment, type MomentResult, type Tuning } from "./moment";
import { World } from "./world";

export interface DrillDef {
  id: string;
  title: string;
  blurb: string;
  scenes: string[];
  pro: boolean;
}

export interface DrillRun {
  id: string;
  drill: DrillDef;
  specs: ScenarioSpec[];
  index: number;
  results: MomentResult[];
  startedAt: number;
}

export interface GameEvents {
  momentDone?(r: MomentResult, run: DrillRun | null): void;
  drillDone?(run: DrillRun): void;
  menu?(): void;
  tapLatency?(ms: number): void;
}

export interface GameOptions {
  clock: Clock;
  debug: boolean;
  /** Fewer camera shakes and no confetti (prefers-reduced-motion, can be overridden). */
  calm: () => boolean;
  tuning: Tuning;
}

const pointTmp: V2 = { x: 0, y: 0 };

export class Game {
  readonly stage: Stage;
  readonly world: World;
  readonly rig: CameraRig;
  readonly hud: Hud;
  readonly board: CoachBoard;
  readonly perf: Perf;
  readonly clock: Clock;
  moment: Moment | null = null;
  run: DrillRun | null = null;
  private single: ScenarioSpec | null = null;
  private backdrop: Moment | null = null;
  private rect: DOMRect;
  private shot: Shot | null = null;
  private gesture: { id: number; x: number; startX: number; fired: boolean } | null = null;
  private latencyProbe: number | null = null;
  private lastFrame = performance.now();
  private frameNo = 0;
  private running = false;
  paused = false;
  events: GameEvents = {};
  tuning: Tuning;

  constructor(
    host: HTMLElement,
    private readonly opts: GameOptions,
  ) {
    this.clock = opts.clock;
    this.tuning = opts.tuning ?? DEFAULT_TUNING;
    this.stage = new Stage(host);
    this.world = new World(this.stage);
    this.rig = new CameraRig(this.stage.camera);
    this.hud = new Hud(host);
    this.board = new CoachBoard(host);
    this.perf = new Perf(host, opts.debug);
    this.rect = this.stage.canvas.getBoundingClientRect();
    window.addEventListener("resize", () => this.onResize());
    window.visualViewport?.addEventListener("resize", () => this.onResize());
    this.bindInput();
    this.board.next.addEventListener("click", () => this.next());
    this.board.replay.addEventListener("click", () => this.replay());
    this.hud.menuButton.addEventListener("click", () => this.toMenu());
    this.stage.onContextLost(() => (this.paused = true));
    this.stage.onContextRestored(() => {
      // three re-uploads geometry and programs lazily; the scene graph is intact.
      this.paused = false;
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.lastFrame = performance.now();
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      // Nothing to draw while the tab is hidden; rAF stops on its own, this guards stepped mode.
      if (document.visibilityState === "hidden" || this.paused) return;
      this.frame();
    };
    requestAnimationFrame(loop);
  }

  /** Renders exactly one frame (stepped mode: called by tests and the recorder). */
  frame(): void {
    const t0 = performance.now();
    this.perf.frame(t0 - this.lastFrame);
    this.lastFrame = t0;
    const dt = this.clock.tick();
    const now = this.clock.now();
    const m = this.moment ?? this.backdrop;
    if (m) {
      if (this.moment) {
        const before = m.phase;
        const events = m.update(now, dt);
        this.onEvents(events, now);
        if (m.phase !== before) this.onPhase(m, now);
        this.updateHud(m, now);
      }
      this.world.sync(m, now, dt);
    }
    if (!this.moment && this.backdrop) this.orbit(now);
    else this.rig.update(now);
    const t1 = performance.now();
    this.stage.render();
    const t2 = performance.now();
    this.frameNo++;
    // The frame that answers the tap has been submitted: measure, then let the moment score it.
    if (this.latencyProbe !== null && this.moment) {
      const ms = this.clock.mode === "live" ? performance.now() - this.latencyProbe : null;
      this.latencyProbe = null;
      if (ms !== null && ms >= 0 && ms < 1000) {
        this.moment.inputToFrameMs = ms;
        this.perf.input(ms);
        this.events.tapLatency?.(ms);
      }
      this.moment.tapReady = true;
    }
    this.hud.placeLabels(this.world.labels, this.world.players.anchors, this.stage.frame, !!this.moment && this.moment.phase !== "review");
    this.perf.split(t1 - t0 + (performance.now() - t2), t2 - t1);
    const info = this.stage.renderer.info.render;
    this.perf.paint(now, { calls: info.calls, triangles: info.triangles, dpr: this.stage.pixelRatio, w: this.stage.width, h: this.stage.height });
  }

  // ---------------------------------------------------------------- flow

  /** A quiet scene behind the menus: players in shape, camera drifting round. */
  showBackdrop(spec: ScenarioSpec): void {
    this.moment = null;
    this.backdrop = new Moment(spec, this.tuning);
    this.world.reset();
    this.shot = this.world.shotFor(this.backdrop);
    this.hud.show(false);
    this.board.hide();
  }

  private orbit(now: number): void {
    const s = this.shot;
    if (!s) return;
    const cam = this.stage.camera;
    const a = now * 0.06;
    const r = 58;
    cam.position.set(s.target.x - Math.cos(a) * r, 30 + Math.sin(now * 0.11) * 4, s.target.z + Math.sin(a) * r);
    cam.fov = 50;
    cam.lookAt(s.target);
    cam.updateProjectionMatrix();
  }

  playDrill(drill: DrillDef, specs: ScenarioSpec[]): void {
    this.single = null;
    this.run = { id: crypto.randomUUID(), drill, specs, index: 0, results: [], startedAt: Date.now() };
    this.startMoment(specs[0]!);
  }

  playScene(spec: ScenarioSpec): void {
    this.single = spec;
    this.run = null;
    this.startMoment(spec);
  }

  private startMoment(spec: ScenarioSpec): void {
    this.adaptResolution();
    this.board.hide();
    this.hud.clearFlash();
    this.world.reset();
    const m = new Moment(spec, this.tuning);
    this.moment = m;
    this.backdrop = null;
    const now = this.clock.now();
    m.start(now);
    this.shot = this.world.shotFor(m);
    this.rig.flyTo(this.shot, now, 1.5, CameraRig.establishing(this.shot));
    this.hud.show(true);
    this.hud.setScans(0);
    this.hud.showBrief(SKILLS[spec.skill], spec.title, spec.brief, !spec.timed);
    this.hud.showScan(false);
    this.hud.setTimer(null);
    this.hud.setHint("");
    this.updateDrillBar();
    crowdOn(0.1);
  }

  private updateDrillBar(): void {
    const r = this.run;
    if (r) {
      const grades = r.results.map((x) => x.grade);
      const score = grades.length ? Math.round(grades.reduce((a, b) => a + b, 0) / grades.length) : null;
      this.hud.setDrill(r.drill.title, r.index, r.specs.length, grades, score);
    } else if (this.single) {
      this.hud.setDrill(this.single.title, 0, 1, this.moment?.result ? [this.moment.result.grade] : [], null);
    }
  }

  next(): void {
    const r = this.run;
    if (!r) {
      if (this.single) this.replay();
      return;
    }
    r.index++;
    if (r.index >= r.specs.length) {
      this.board.hide();
      this.hud.show(false);
      this.moment = null;
      this.showBackdrop(r.specs[0]!);
      this.events.drillDone?.(r);
      return;
    }
    this.startMoment(r.specs[r.index]!);
  }

  replay(): void {
    const spec = this.moment?.spec ?? this.single;
    if (spec) this.startMoment(spec);
  }

  toMenu(): void {
    this.board.hide();
    this.hud.show(false);
    const spec = this.moment?.spec;
    this.moment = null;
    this.run = null;
    if (spec) this.showBackdrop(spec);
    this.events.menu?.();
  }

  // ---------------------------------------------------------------- per-frame UI

  private onPhase(m: Moment, now: number): void {
    void now;
    if (m.phase === "play") {
      this.hud.hideBrief();
      this.hud.showScan(true);
      this.hud.setHint(this.isEarly() ? "Check your shoulders before the ball arrives" : "");
    } else if (m.phase === "decide") {
      this.hud.showScan(false);
      this.hud.setHint(m.timed ? "Tap where the ball goes" : "Tap where the ball goes · take your time");
    } else if (m.phase === "outcome") {
      this.hud.setHint("");
      this.hud.setTimer(null);
      const r = m.result!;
      const v = verdict(r);
      this.hud.flash(v.text, v.kind);
      this.world.markers.best.mesh.visible = false;
      if (r.choice && r.best.option.id !== r.choice.option.id && !r.correct) {
        const me = m.truePos(m.scenario.you, m.commitTau, { x: 0, y: 0 });
        this.world.markers.best.set(me.x, me.y, r.best.option.target.x, r.best.option.target.y);
      }
      if (!r.choice) this.world.markers.best.set(r.decision.ballAt.x, r.decision.ballAt.y, r.best.option.target.x, r.best.option.target.y);
    } else if (m.phase === "review") {
      this.hud.clearFlash();
      const r = m.result!;
      if (this.run) {
        this.run.results.push(r);
        this.updateDrillBar();
      }
      this.events.momentDone?.(r, this.run);
      const last = !this.run || this.run.index === this.run.specs.length - 1;
      this.board.show(m, r, !!this.run && last, true);
    }
  }

  private isEarly(): boolean {
    return !this.run || this.run.index < 2;
  }

  private updateHud(m: Moment, now: number): void {
    if (m.phase === "decide" && m.timed) this.hud.setTimer(m.timeLeft(now) / this.tuning.decideWindow);
    if (m.phase === "play") this.hud.setScans(m.vision.scans.length);
  }

  private onEvents(events: string[], now: number): void {
    const m = this.moment!;
    for (const e of events) {
      if (e === "play") sfx("whistle", 0.5);
      else if (e === "kick") sfx("kick", 0.8);
      else if (e === "touch") sfx("touch", 0.7);
      else if (e === "heavy-touch") {
        sfx("touch", 0.9);
        this.hud.flash("Heavy touch: you were looking away", "bad");
      } else if (e === "timeout") sfx("bad", 0.8);
      else if (e === "arrive") {
        const r = m.result!;
        if (r.correct) {
          sfx("good", 0.8);
          sfx("cheer", 0.5);
          if (r.grade === 100 && !this.opts.calm()) {
            const t = r.choice!.option.target;
            this.world.confetti.fire(t.x, t.y, now);
          }
        } else sfx("touch", 0.6);
      } else if (e === "cut") {
        sfx("bad", 0.7);
        sfx("ooh", 0.6);
        if (!this.opts.calm()) this.rig.shake(now);
        buzz(40);
      }
    }
  }

  private adaptResolution(): void {
    // Between moments only: changing the buffer size mid-play would stutter.
    const p90 = this.perf.percentile(0.9);
    const max = Math.min(window.devicePixelRatio || 1, 2);
    const pr = this.stage.pixelRatio;
    if (p90 > 22 && pr > 1) this.stage.setPixelRatio(Math.max(1, pr - 0.25));
    else if (p90 > 0 && p90 < 13 && pr < max) this.stage.setPixelRatio(Math.min(max, pr + 0.25));
    this.perf.resetWindow();
  }

  // ---------------------------------------------------------------- input

  private onResize(): void {
    this.stage.resize();
    this.rect = this.stage.canvas.getBoundingClientRect();
    const m = this.moment;
    if (m) {
      this.shot = this.world.shotFor(m);
      this.rig.cut(this.shot);
    }
  }

  private bindInput(): void {
    const c = this.stage.canvas;
    c.addEventListener("pointerdown", (e) => this.onPointerDown(e), { passive: false });
    c.addEventListener("pointermove", (e) => this.onPointerMove(e), { passive: false });
    const end = (e: PointerEvent) => {
      if (this.gesture?.id === e.pointerId) this.gesture = null;
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    for (const [btn, side] of [[this.hud.scanLeft, -1], [this.hud.scanRight, 1]] as const) {
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.scan(side);
      });
    }
    window.addEventListener("keydown", (e) => {
      const m = this.moment;
      if (!m) return;
      if (e.key === "ArrowLeft" || e.key === "a") this.scan(-1);
      else if (e.key === "ArrowRight" || e.key === "d") this.scan(1);
      else if ((e.key === " " || e.key === "Enter") && m.phase === "brief") m.skipBrief = true;
      else if ((e.key === " " || e.key === "Enter") && m.phase === "review" && document.activeElement === document.body) this.next();
    });
  }

  /** Screen side (-1 left, 1 right) to the head turn that looks that way on screen. */
  scan(screenSide: -1 | 1): void {
    const m = this.moment;
    if (!m || m.phase !== "play") return;
    const body = m.vision.bodyYaw(m.tau);
    const A = m.vision.params.scanAngle;
    // With the camera looking up the pitch, screen-right is +y: sin(heading).
    const left = Math.sin(body + A) < Math.sin(body - A) ? 1 : -1;
    const side = (screenSide < 0 ? left : -left) as 1 | -1;
    if (m.scan(side, this.clock.now())) {
      sfx("scan", 0.5);
      this.hud.pulseScan(screenSide);
      this.hud.setScans(m.vision.scans.length);
    }
  }

  private onPointerDown(e: PointerEvent): void {
    if (!e.isPrimary) return;
    const m = this.moment;
    if (!m) return;
    e.preventDefault();
    if (m.phase === "brief") {
      m.skipBrief = true;
      return;
    }
    if (m.phase === "play") {
      this.gesture = { id: e.pointerId, x: e.clientX, startX: e.clientX, fired: false };
      return;
    }
    if (m.phase === "decide") this.commitTap(e, m);
  }

  private onPointerMove(e: PointerEvent): void {
    const g = this.gesture;
    const m = this.moment;
    if (!g || g.id !== e.pointerId || g.fired || !m || m.phase !== "play") return;
    const dx = e.clientX - g.startX;
    // Edge swipes belong to the browser (back gesture); only the middle 80% scans.
    const w = this.stage.width;
    if (Math.abs(dx) > 20 && g.startX > w * 0.1 && g.startX < w * 0.9) {
      g.fired = true;
      this.scan(dx < 0 ? -1 : 1);
    }
  }

  /** The hot path: everything here is constant-time and allocation-light. */
  private commitTap(e: PointerEvent, m: Moment): void {
    const t0 = performance.now();
    const at = this.clock.fromEvent(e.timeStamp);
    if (at < m.decideOpenedAt) return;
    const f = this.stage.frame;
    const mate = snapTo(f, this.rect, e.clientX, e.clientY, this.world.targets);
    const point = mate ? { x: mate.x, y: mate.y } : groundPoint(f, this.rect, e.clientX, e.clientY, pointTmp);
    if (!point) return;
    const target = { x: point.x, y: point.y };
    if (!m.tap({ point: target, mateId: mate?.id ?? null, at })) return;
    const now = this.clock.now();
    this.world.markers.burst(target.x, target.y, now);
    const me = this.world.poses[0]!;
    this.world.markers.choice.set(me.x, me.y, target.x, target.y);
    this.hud.ripple(e.clientX - this.rect.left, e.clientY - this.rect.top);
    sfx("tap", 0.9);
    buzz(12);
    this.latencyProbe = e.timeStamp;
    this.perf.lastHandlerMs = performance.now() - t0;
  }
}
