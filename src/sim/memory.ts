// What the receiver knows. You see a cone in front of you; checking a shoulder
// swings that cone round for a third of a second. Anyone who stays in the cone
// long enough is "live"; everyone else is remembered where you last saw them.
// The renderer draws only this knowledge until the decision is revealed.

import { angleDiff, heading, smoothstep, type V2 } from "../core/math";
import { posAt, type Scenario } from "./scenario";

export interface VisionParams {
  /** Half-width of the cone you see, radians. */
  halfAngle: number;
  /** How far you can read players, m. */
  range: number;
  /** Time someone must stay in the cone to register, s. */
  dwell: number;
  /** Players this close are felt even when unseen, m. */
  nearSense: number;
  /** How far a shoulder check turns your head, radians. */
  scanAngle: number;
  scanOut: number;
  scanHold: number;
  scanBack: number;
}

const DEG = Math.PI / 180;
export const DEFAULT_VISION: VisionParams = {
  halfAngle: 35 * DEG,
  range: 45,
  dwell: 0.05,
  nearSense: 1.5,
  scanAngle: 150 * DEG,
  scanOut: 0.09,
  scanHold: 0.15,
  scanBack: 0.09,
};

export interface Sighting {
  x: number;
  y: number;
  /** Scenario time of the sighting. */
  t: number;
  live: boolean;
  dwell: number;
}

export interface Scan {
  side: 1 | -1;
  start: number;
}

const STEP = 1 / 120;

export class Vision {
  readonly memory = new Map<string, Sighting>();
  readonly scans: Scan[] = [];
  private lastT = 0;
  private readonly p: V2 = { x: 0, y: 0 };
  private readonly me: V2 = { x: 0, y: 0 };

  constructor(
    readonly scenario: Scenario,
    readonly params: VisionParams = DEFAULT_VISION,
  ) {}

  /** The picture you have before play starts: everyone, at time t. */
  seedAll(t: number): void {
    for (const e of this.scenario.all) {
      if (e === this.scenario.you) continue;
      posAt(e, t, this.p);
      this.memory.set(e.id, { x: this.p.x, y: this.p.y, t, live: false, dwell: 0 });
    }
    this.lastT = t;
  }

  get scanDuration(): number {
    return this.params.scanOut + this.params.scanHold + this.params.scanBack;
  }

  isScanning(t: number): boolean {
    const last = this.scans[this.scans.length - 1];
    return !!last && t >= last.start && t < last.start + this.scanDuration;
  }

  /** Starts a shoulder check unless one is already running. */
  startScan(side: 1 | -1, t: number): boolean {
    if (this.isScanning(t)) return false;
    this.scans.push({ side, start: t });
    return true;
  }

  /** Head turn relative to the body at time t, radians. */
  scanOffset(t: number): number {
    const last = this.scans[this.scans.length - 1];
    if (!last) return 0;
    const { scanOut, scanHold, scanBack, scanAngle } = this.params;
    const local = t - last.start;
    if (local < 0) return 0;
    let k: number;
    if (local < scanOut) k = smoothstep(local / scanOut);
    else if (local < scanOut + scanHold) k = 1;
    else if (local < scanOut + scanHold + scanBack) k = 1 - smoothstep((local - scanOut - scanHold) / scanBack);
    else k = 0;
    return last.side * scanAngle * k;
  }

  /** You face where the ball comes from until it arrives, then keep that line. */
  bodyYaw(t: number): number {
    const s = this.scenario;
    posAt(s.you, Math.min(t, s.arrival), this.me);
    return heading(s.kickFrom.x - this.me.x, s.kickFrom.y - this.me.y);
  }

  gazeYaw(t: number): number {
    return this.bodyYaw(t) + this.scanOffset(t);
  }

  /** Advances knowledge to scenario time t in fixed 120 Hz steps (frame-rate independent). */
  step(t: number): void {
    while (this.lastT + STEP <= t) {
      this.lastT += STEP;
      this.sample(this.lastT, STEP);
    }
  }

  private sample(t: number, dt: number): void {
    const s = this.scenario;
    const { halfAngle, range, dwell, nearSense } = this.params;
    posAt(s.you, t, this.me);
    const gaze = this.gazeYaw(t);
    for (const e of s.all) {
      if (e === s.you) continue;
      posAt(e, t, this.p);
      const dx = this.p.x - this.me.x;
      const dy = this.p.y - this.me.y;
      const d = Math.hypot(dx, dy);
      const inCone = d <= nearSense || (d <= range && Math.abs(angleDiff(heading(dx, dy), gaze)) <= halfAngle);
      let m = this.memory.get(e.id);
      if (!m) {
        m = { x: 0, y: 0, t: -Infinity, live: false, dwell: 0 };
        this.memory.set(e.id, m);
      }
      if (inCone) {
        m.dwell += dt;
        if (m.dwell >= dwell - 1e-9) {
          m.live = true;
          m.x = this.p.x;
          m.y = this.p.y;
          m.t = t;
        }
      } else {
        m.dwell = 0;
        m.live = false;
      }
    }
  }

  isLive(id: string): boolean {
    return this.memory.get(id)?.live ?? false;
  }

  /** Seconds since the last scan finished, measured at the ball's arrival (null if you never scanned). */
  lastScanBeforeArrival(): number | null {
    const arrival = this.scenario.arrival;
    let best: number | null = null;
    for (const sc of this.scans) {
      const end = sc.start + this.scanDuration;
      if (sc.start <= arrival) best = Math.max(0, arrival - end);
    }
    return best;
  }

  /** Scans started before the ball arrived. */
  scansBeforeArrival(): number {
    return this.scans.filter((sc) => sc.start <= this.scenario.arrival).length;
  }

  /** Looking away when the ball arrives costs you a heavy touch. */
  headTurnedAtArrival(): boolean {
    return Math.abs(this.scanOffset(this.scenario.arrival)) > 0.5;
  }
}
