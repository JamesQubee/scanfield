// In-game overlay. Updated with transforms and text only: no layout reads in the
// frame loop, so the HUD never forces a reflow between a tap and its feedback.

import type { Label } from "../game/world";
import { toScreen } from "../input/pick";
import type { FrameCamera } from "../render/stage";
import type { Vector3 } from "three";
import { h } from "./h";

const pt = { x: 0, y: 0 };

export class Hud {
  readonly root: HTMLDivElement;
  private readonly title = h("div", { class: "hud-title" });
  private readonly pips = h("div", { class: "hud-pips" });
  private readonly score = h("div", { class: "hud-score" });
  private readonly banner = h("div", { class: "hud-banner" });
  private readonly bannerSkill = h("div", { class: "hud-banner-skill" });
  private readonly bannerTitle = h("div", { class: "hud-banner-title" });
  private readonly bannerBrief = h("div", { class: "hud-banner-brief" });
  private readonly bannerGo = h("div", { class: "hud-banner-go", text: "Tap to play" });
  private readonly hint = h("div", { class: "hud-hint" });
  private readonly timer = h("div", { class: "hud-timer" }, h("div", { class: "hud-timer-fill" }));
  private readonly flashEl = h("div", { class: "hud-flash" });
  private readonly labelsEl = h("div", { class: "hud-labels", attrs: { "aria-hidden": "true" } });
  private readonly ripples: HTMLDivElement[] = [];
  private rippleIndex = 0;
  private readonly chips: HTMLDivElement[] = [];
  readonly scanLeft: HTMLButtonElement;
  readonly scanRight: HTMLButtonElement;
  readonly menuButton: HTMLButtonElement;
  private readonly scanCount = h("div", { class: "hud-scans" });
  private timerFill: HTMLDivElement;
  private lastTimer = -1;
  private lastHint = "";

  constructor(host: HTMLElement) {
    const eye = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M12 5C6.5 5 2.7 9.3 1.5 12c1.2 2.7 5 7 10.5 7s9.3-4.3 10.5-7C21.3 9.3 17.5 5 12 5Zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Zm0-2.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/></svg>';
    this.scanLeft = h("button", { class: "scan-btn left", attrs: { type: "button", "aria-label": "Check over your left shoulder" } });
    this.scanLeft.innerHTML = `<span class="scan-arrow">◀</span>${eye}<span class="scan-label">Check</span>`;
    this.scanRight = h("button", { class: "scan-btn right", attrs: { type: "button", "aria-label": "Check over your right shoulder" } });
    this.scanRight.innerHTML = `${eye}<span class="scan-arrow">▶</span><span class="scan-label">Check</span>`;
    this.menuButton = h("button", { class: "hud-menu", attrs: { type: "button", "aria-label": "Menu" }, text: "☰" });
    this.banner.append(this.bannerSkill, this.bannerTitle, this.bannerBrief, this.bannerGo);
    for (let i = 0; i < 4; i++) {
      const r = h("div", { class: "hud-ripple" });
      this.ripples.push(r);
    }
    this.root = h(
      "div",
      { class: "hud" },
      this.labelsEl,
      h("div", { class: "hud-top" }, this.menuButton, h("div", { class: "hud-top-mid" }, this.title, this.pips), this.score),
      this.banner,
      this.timer,
      this.hint,
      this.flashEl,
      this.scanCount,
      this.scanLeft,
      this.scanRight,
      ...this.ripples,
    );
    this.timerFill = this.timer.firstElementChild as HTMLDivElement;
    host.append(this.root);
  }

  show(on: boolean): void {
    this.root.classList.toggle("on", on);
  }

  setDrill(title: string, index: number, total: number, grades: number[], score: number | null): void {
    this.title.textContent = title;
    this.pips.replaceChildren(
      ...Array.from({ length: total }, (_, i) => {
        const g = grades[i];
        const cls = g === undefined ? (i === index ? "pip now" : "pip") : g >= 85 ? "pip good" : g >= 50 ? "pip ok" : "pip bad";
        return h("span", { class: cls });
      }),
    );
    this.score.textContent = score === null ? "" : String(score);
  }

  showBrief(skill: string, title: string, brief: string, untimed: boolean): void {
    this.bannerSkill.textContent = untimed ? `${skill} · take your time` : skill;
    this.bannerTitle.textContent = title;
    this.bannerBrief.textContent = brief;
    this.banner.classList.add("on");
  }

  hideBrief(): void {
    this.banner.classList.remove("on");
  }

  setHint(text: string): void {
    if (text === this.lastHint) return;
    this.lastHint = text;
    this.hint.textContent = text;
    this.hint.classList.toggle("on", !!text);
  }

  /** Fraction of decision time left (null hides the bar). */
  setTimer(frac: number | null): void {
    const v = frac === null ? -1 : Math.round(frac * 200) / 200;
    if (v === this.lastTimer) return;
    this.lastTimer = v;
    this.timer.classList.toggle("on", frac !== null);
    if (frac !== null) {
      this.timerFill.style.transform = `scaleX(${v})`;
      this.timer.classList.toggle("low", v < 0.34);
    }
  }

  showScan(on: boolean): void {
    this.scanLeft.classList.toggle("on", on);
    this.scanRight.classList.toggle("on", on);
    this.scanCount.classList.toggle("on", on);
  }

  private lastScans = -1;

  setScans(n: number): void {
    if (n === this.lastScans) return;
    this.lastScans = n;
    this.scanCount.textContent = n === 0 ? "No checks yet" : n === 1 ? "1 check" : `${n} checks`;
  }

  pulseScan(side: -1 | 1): void {
    const b = side < 0 ? this.scanLeft : this.scanRight;
    b.animate([{ transform: "scale(0.9)" }, { transform: "scale(1.06)" }, { transform: "scale(1)" }], { duration: 260, easing: "ease-out" });
  }

  /**
   * Instant tap feedback in the DOM (the 3D burst lands in the same frame).
   * Web Animations, not a class toggle: restarting a CSS animation needs a forced
   * reflow, and nothing in the tap path may force layout.
   */
  ripple(x: number, y: number): void {
    const r = this.ripples[this.rippleIndex++ % this.ripples.length]!;
    const at = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    r.animate(
      [
        { transform: `${at} scale(0.3)`, opacity: 0.95 },
        { transform: `${at} scale(1.6)`, opacity: 0 },
      ],
      { duration: 420, easing: "cubic-bezier(.2,.7,.3,1)" },
    );
  }

  flash(text: string, kind: "good" | "ok" | "bad"): void {
    this.flashEl.textContent = text;
    this.flashEl.className = `hud-flash on ${kind}`;
  }

  clearFlash(): void {
    this.flashEl.className = "hud-flash";
  }

  /** Number chips over every player, positioned from the frame the player is seeing. */
  placeLabels(labels: readonly Label[], anchors: readonly Vector3[], f: FrameCamera, visible: boolean): void {
    this.labelsEl.classList.toggle("on", visible);
    if (!visible) return;
    while (this.chips.length < labels.length) {
      const c = h("div", { class: "chip" });
      this.chips.push(c);
      this.labelsEl.append(c);
    }
    for (let i = 0; i < this.chips.length; i++) {
      const c = this.chips[i]!;
      const l = labels[i];
      if (!l) {
        c.style.display = "none";
        continue;
      }
      const a = anchors[l.anchor]!;
      toScreen(f, a.x + 52.5, a.z + 34, a.y, pt);
      const cls = `chip ${l.team}${l.you ? " you" : ""}${l.ghost ? " ghost" : ""}`;
      if (c.className !== cls) c.className = cls;
      const text = l.you ? "YOU" : String(l.number);
      if (c.textContent !== text) c.textContent = text;
      c.style.display = "";
      c.style.transform = `translate3d(${pt.x.toFixed(1)}px, ${pt.y.toFixed(1)}px, 0) translate(-50%, -100%)`;
    }
  }
}
