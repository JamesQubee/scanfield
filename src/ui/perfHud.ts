// ?debug=1 overlay: frame rate, frame-time p95, the last tap's input-to-frame time
// and handler cost, the per-frame CPU split (game logic vs render call), draw calls,
// triangles and pixel ratio. Also feeds the resolution controller.

import { h } from "./h";

const N = 240;

function quantile(a: Float32Array, count: number, p: number): number {
  const k = Math.min(count, a.length);
  if (k === 0) return 0;
  const s = Array.from(a.subarray(0, k)).sort((x, y) => x - y);
  return s[Math.min(k - 1, Math.floor(p * k))]!;
}

export class Perf {
  private readonly times = new Float32Array(N);
  private n = 0;
  private readonly js = new Float32Array(N);
  private readonly gl = new Float32Array(N);
  private m = 0;
  lastInputMs: number | null = null;
  /** CPU time of the last tap handler, ms. */
  lastHandlerMs: number | null = null;
  inputSamples: number[] = [];
  readonly el: HTMLDivElement | null;
  private lastPaint = 0;

  constructor(host: HTMLElement, visible: boolean) {
    this.el = visible ? h("div", { class: "perf" }) : null;
    if (this.el) host.append(this.el);
  }

  frame(ms: number): void {
    this.times[this.n++ % N] = ms;
  }

  /** Per-frame CPU split: game logic + HUD, and the render call. */
  split(jsMs: number, renderMs: number): void {
    this.js[this.m % N] = jsMs;
    this.gl[this.m % N] = renderMs;
    this.m++;
  }

  splitStats(): { jsP50: number; jsP95: number; renderP50: number; renderP95: number } {
    return {
      jsP50: quantile(this.js, this.m, 0.5),
      jsP95: quantile(this.js, this.m, 0.95),
      renderP50: quantile(this.gl, this.m, 0.5),
      renderP95: quantile(this.gl, this.m, 0.95),
    };
  }

  input(ms: number): void {
    this.lastInputMs = ms;
    this.inputSamples.push(ms);
    if (this.inputSamples.length > 200) this.inputSamples.shift();
  }

  /** Percentile of recent frame times, ms. */
  percentile(p: number): number {
    return quantile(this.times, this.n, p);
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
    const hnd = this.lastHandlerMs === null ? "—" : `${this.lastHandlerMs.toFixed(2)} ms`;
    const sp = this.splitStats();
    this.el.textContent = [
      `${fps} fps · p95 ${p95.toFixed(1)} ms`,
      `tap→frame ${inp} · handler ${hnd}`,
      `game ${sp.jsP50.toFixed(2)} ms · render ${sp.renderP50.toFixed(1)} ms`,
      `${info.calls} draws · ${(info.triangles / 1000).toFixed(1)}k tris`,
      `${info.w}×${info.h} @${info.dpr.toFixed(2)}x`,
    ].join("\n");
  }
}
