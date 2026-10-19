// ?debug=1 overlay: frame rate, frame-time p95, the last tap's input-to-frame time,
// draw calls, triangles and pixel ratio. Also feeds the resolution controller.

import { h } from "./h";

export class Perf {
  private readonly times = new Float32Array(240);
  private n = 0;
  lastInputMs: number | null = null;
  inputSamples: number[] = [];
  readonly el: HTMLDivElement | null;
  private lastPaint = 0;

  constructor(host: HTMLElement, visible: boolean) {
    this.el = visible ? h("div", { class: "perf" }) : null;
    if (this.el) host.append(this.el);
  }

  frame(ms: number): void {
    this.times[this.n++ % this.times.length] = ms;
  }

  input(ms: number): void {
    this.lastInputMs = ms;
    this.inputSamples.push(ms);
    if (this.inputSamples.length > 200) this.inputSamples.shift();
  }

  /** Percentile of recent frame times, ms. */
  percentile(p: number): number {
    const k = Math.min(this.n, this.times.length);
    if (k === 0) return 0;
    const arr = Array.from(this.times.subarray(0, k)).sort((a, b) => a - b);
    return arr[Math.min(k - 1, Math.floor(p * k))]!;
  }

  resetWindow(): void {
    this.n = 0;
  }

  paint(now: number, info: { calls: number; triangles: number; dpr: number; w: number; h: number }): void {
    if (!this.el || now - this.lastPaint < 0.25) return;
    this.lastPaint = now;
    const p50 = this.percentile(0.5);
    const p95 = this.percentile(0.95);
    const fps = p50 > 0 ? Math.round(1000 / p50) : 0;
    const inp = this.lastInputMs === null ? "—" : `${this.lastInputMs.toFixed(1)} ms`;
    this.el.textContent = `${fps} fps · p95 ${p95.toFixed(1)} ms\ntap→frame ${inp}\n${info.calls} draws · ${(info.triangles / 1000).toFixed(1)}k tris\n${info.w}×${info.h} @${info.dpr.toFixed(2)}x`;
  }
}
