// Real time for the game, in seconds. "live" follows performance.now(); "stepped"
// advances a fixed amount per frame, so a recording or a test sees the same frames
// whatever the machine's speed (this demo machine renders WebGL in software).

export class Clock {
  private t: number;
  private last: number;

  constructor(
    readonly mode: "live" | "stepped" = "live",
    readonly step = 1 / 60,
  ) {
    this.t = mode === "live" ? performance.now() / 1000 : 0;
    this.last = this.t;
  }

  /** Advances to this frame and returns the frame's delta in seconds (capped). */
  tick(): number {
    if (this.mode === "live") this.t = performance.now() / 1000;
    else this.t += this.step;
    const dt = Math.min(0.1, Math.max(0, this.t - this.last));
    this.last = this.t;
    return dt;
  }

  now(): number {
    return this.t;
  }

  /**
   * Clock time of an input event. Event timestamps share performance.now()'s time
   * origin in current browsers; if one does not (a value far from now), fall back.
   */
  fromEvent(timeStamp: number): number {
    if (this.mode === "stepped") return this.t;
    const now = performance.now();
    return Math.abs(now - timeStamp) < 1000 ? timeStamp / 1000 : now / 1000;
  }
}
