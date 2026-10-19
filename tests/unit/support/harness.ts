// Drives a Moment the way Game.frame() does (fixed 60 Hz clock), without WebGL.
import { Moment, type Tap } from "../../../src/game/moment";
import { posAt } from "../../../src/sim/scenario";
import type { ScenarioSpec } from "../../../src/sim/scenario";

export interface Plan {
  /** Scans as [tau, side]; issued on the first frame whose tau >= the given value. */
  scans?: [number, 1 | -1][];
  /** Real seconds after the decide phase opens to tap (null = never). */
  tapAfter?: number | null;
  tap?: (m: Moment) => Omit<Tap, "at">;
  /** Called after every frame. */
  onFrame?: (m: Moment, now: number) => void;
}

export function play(spec: ScenarioSpec, plan: Plan, maxFrames = 2000) {
  const m = new Moment(spec);
  const dt = 1 / 60;
  let now = 0;
  m.start(now);
  m.skipBrief = true;
  const scans = [...(plan.scans ?? [])];
  let probe = false;
  let tapped = false;
  const events: string[] = [];
  for (let f = 0; f < maxFrames && m.phase !== "review"; f++) {
    now += dt;
    events.push(...m.update(now, dt));
    // "render", then let the moment score the tap
    if (probe) {
      m.tapReady = true;
      probe = false;
    }
    plan.onFrame?.(m, now);
    // input between frames
    while (scans.length && m.phase === "play" && m.tau >= scans[0]![0]) {
      const [, side] = scans.shift()!;
      m.scan(side, now);
    }
    if (!tapped && m.phase === "decide" && plan.tapAfter != null && now - m.decideOpenedAt >= plan.tapAfter - 1e-9 && plan.tap) {
      const t = plan.tap(m);
      if (m.tap({ ...t, at: now })) {
        tapped = true;
        probe = true;
      }
    }
  }
  return { m, events };
}

export const tapMate = (id: string) => (m: Moment) => ({ point: posAt(m.scenario.byId.get(id)!, m.tau), mateId: id });
export const tapPoint = (x: number, y: number) => () => ({ point: { x, y }, mateId: null });
