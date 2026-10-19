// The coach board: a top-down tactics board drawn with Canvas 2D after each
// decision. It shows every option scored, your choice, the best one, where you
// thought players were versus where they really were, and when you scanned.

import type { MomentResult } from "../game/moment";
import type { Moment } from "../game/moment";
import type { OptionEval } from "../eval/evaluate";
import { posAt } from "../sim/scenario";
import { h } from "./h";

const GREEN = "#22c55e";
const AMBER = "#f59e0b";
const RED = "#ef4444";
const GOLD = "#ffd23f";

export const gradeColor = (g: number): string => (g >= 85 ? GREEN : g >= 50 ? AMBER : RED);

export function verdict(r: MomentResult): { text: string; kind: "good" | "ok" | "bad" } {
  if (r.timeout) return { text: "Too slow", kind: "bad" };
  if (r.correct && r.blind) return { text: "Right call, but a guess", kind: "ok" };
  if (r.correct) return { text: r.outcome === "success" ? "Spot on!" : "Right idea", kind: "good" };
  if (r.outcome === "intercepted") return { text: "Intercepted!", kind: "bad" };
  if (r.outcome === "tackled") return { text: "Tackled!", kind: "bad" };
  return r.grade >= 50 ? { text: "It worked, but there was better", kind: "ok" } : { text: "Risky", kind: "bad" };
}

function arrow(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string, width: number, dashed = false): void {
  const a = Math.atan2(y1 - y0, x1 - x0);
  const head = Math.min(12, Math.hypot(x1 - x0, y1 - y0) * 0.4);
  g.save();
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = width;
  g.lineCap = "round";
  if (dashed) g.setLineDash([6, 5]);
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1 - Math.cos(a) * head * 0.8, y1 - Math.sin(a) * head * 0.8);
  g.stroke();
  g.setLineDash([]);
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x1 - Math.cos(a - 0.45) * head, y1 - Math.sin(a - 0.45) * head);
  g.lineTo(x1 - Math.cos(a + 0.45) * head, y1 - Math.sin(a + 0.45) * head);
  g.closePath();
  g.fill();
  g.restore();
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fillStyle = GOLD;
  g.fill();
  g.strokeStyle = "#5c4400";
  g.lineWidth = 1.2;
  g.stroke();
}

export class CoachBoard {
  readonly root: HTMLDivElement;
  private readonly canvas = h("canvas", { class: "board-canvas", attrs: { role: "img" } });
  private readonly timeline = h("canvas", { class: "board-timeline", attrs: { role: "img" } });
  private readonly verdictEl = h("div", { class: "board-verdict" });
  private readonly gradeEl = h("div", { class: "board-grade" });
  private readonly lines = h("div", { class: "board-lines" });
  private readonly why = h("p", { class: "board-why" });
  private readonly tip = h("p", { class: "board-tip" });
  private readonly stats = h("div", { class: "board-stats" });
  readonly next = h("button", { class: "btn primary board-next", attrs: { type: "button" }, text: "Next" });
  readonly replay = h("button", { class: "btn ghost board-replay", attrs: { type: "button" }, text: "Try again" });

  constructor(host: HTMLElement) {
    this.root = h(
      "div",
      { class: "board", attrs: { role: "dialog", "aria-label": "Coach board" } },
      h("div", { class: "board-head" }, this.gradeEl, this.verdictEl),
      this.canvas,
      h("div", { class: "board-legend" }, h("span", { class: "lg you" }, "your choice"), h("span", { class: "lg best" }, "best"), h("span", { class: "lg ghost" }, "where you thought")),
      this.lines,
      this.why,
      this.tip,
      this.timeline,
      this.stats,
      h("div", { class: "board-actions" }, this.replay, this.next),
    );
    host.append(this.root);
  }

  hide(): void {
    this.root.classList.remove("on");
  }

  show(moment: Moment, r: MomentResult, last: boolean, canReplay: boolean): void {
    const v = verdict(r);
    this.verdictEl.textContent = v.text;
    this.verdictEl.className = `board-verdict ${v.kind}`;
    this.gradeEl.textContent = String(r.grade);
    this.gradeEl.style.background = gradeColor(r.grade);
    const yours = r.choice ? `${r.choice.option.label}` : "No decision in time";
    const bestLabel = r.best.option.label;
    this.lines.replaceChildren(
      h("div", { class: "board-line" }, h("b", { text: "You: " }), `${yours}${r.choice ? ` · ${Math.round(r.choice.p * 100)}% safe` : ""}`),
      h("div", { class: "board-line" }, h("b", { text: "Best: " }), `${bestLabel} · ${Math.round(r.best.p * 100)}% safe`),
    );
    const notes: string[] = [];
    if (r.blind) notes.push(`You had not checked on ${moment.spec.keyEntity?.startsWith("o") ? "their" : "our"} ${moment.scenario.byId.get(moment.spec.keyEntity!)!.number} since play started, so this was a guess. Scanning makes it a decision.`);
    if (r.heavyTouch) notes.push("You were looking away when the ball arrived: heavy first touch, everything took 0.25 s longer.");
    this.why.textContent = [moment.spec.coach.why, ...notes].join(" ");
    this.tip.textContent = moment.spec.coach.tip;
    const reaction = r.reactionMs === null ? "—" : `${(r.reactionMs / 1000).toFixed(2)} s`;
    const scanText = r.scans === 0 ? "no checks" : `${r.scans} check${r.scans > 1 ? "s" : ""}${r.lastScanBeforeArrivalMs !== null ? `, last ${(r.lastScanBeforeArrivalMs / 1000).toFixed(1)} s before the ball` : ""}`;
    this.stats.replaceChildren(
      h("span", { class: "stat" }, h("b", { text: "Decision " }), reaction),
      h("span", { class: "stat" }, h("b", { text: "Scanning " }), scanText),
      h("span", { class: "stat tech", attrs: { title: "Time from your finger touching the glass to the frame that shows the response being submitted" } }, h("b", { text: "Tap → frame " }), r.inputToFrameMs === null ? "—" : `${r.inputToFrameMs.toFixed(0)} ms`),
    );
    this.next.textContent = last ? "See results" : "Next";
    this.replay.style.display = canReplay ? "" : "none";
    this.root.classList.add("on");
    // Draw after layout so the canvas knows its size.
    requestAnimationFrame(() => {
      this.drawBoard(moment, r);
      this.drawTimeline(moment);
    });
    this.canvas.setAttribute("aria-label", `Board: you chose ${yours}; best was ${bestLabel}.`);
  }

  private drawBoard(moment: Moment, r: MomentResult): void {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = c.clientWidth || 340;
    const H = c.clientHeight || 260;
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = moment.scenario;
    const t = moment.commitTau;
    const pos = new Map(s.all.map((e) => [e.id, posAt(e, t)]));
    // Fit the action (attack up the board: pitch x -> screen up, pitch y -> screen right).
    const pts = [...pos.values(), ...r.decision.candidates.map((cn) => cn.option.target)];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const pad = 4;
    minX -= pad; maxX += pad; minY -= pad; maxY += pad;
    const scale = Math.min(W / (maxY - minY), H / (maxX - minX));
    const ox = (W - (maxY - minY) * scale) / 2;
    const oy = (H - (maxX - minX) * scale) / 2;
    const sx = (y: number) => ox + (y - minY) * scale;
    const sy = (x: number) => H - (oy + (x - minX) * scale);

    // Grass and markings.
    g.fillStyle = "#2f7d3c";
    g.fillRect(0, 0, W, H);
    for (let x = Math.floor(minX / 5.25) * 5.25; x < maxX; x += 5.25) {
      if (Math.round(x / 5.25) % 2 === 0) continue;
      g.fillStyle = "#34873f";
      g.fillRect(0, sy(x + 5.25), W, 5.25 * scale);
    }
    g.strokeStyle = "rgba(255,255,255,0.55)";
    g.lineWidth = 1.2;
    g.strokeRect(sx(0), sy(105), 68 * scale, 105 * scale);
    g.beginPath();
    g.moveTo(sx(0), sy(52.5));
    g.lineTo(sx(68), sy(52.5));
    g.stroke();
    g.beginPath();
    g.arc(sx(34), sy(52.5), 9.15 * scale, 0, Math.PI * 2);
    g.stroke();
    g.strokeRect(sx(13.84), sy(105), 40.32 * scale, 16.5 * scale);
    g.strokeRect(sx(13.84), sy(16.5), 40.32 * scale, 16.5 * scale);

    const me = pos.get(s.you.id)!;
    // All passes, coloured by grade; carries only as the best carry direction.
    const evs = r.decision.candidates;
    const bestCarry = evs.filter((e) => e.option.kind === "carry").sort((a, b) => b.ev - a.ev)[0];
    const shown: OptionEval[] = evs.filter((e) => e.option.kind !== "carry");
    if (bestCarry) shown.push(bestCarry);
    const bestEv = Math.max(r.best.ev, r.choice?.ev ?? -Infinity);
    const gradeOf = (e: OptionEval) => Math.round(100 * Math.max(0, Math.min(1, 1 - (bestEv - e.ev) / moment.tuning.model.gradeScale)));
    // Carries are judged over a few metres; draw them longer so the direction reads.
    const tip = (e: OptionEval) => {
      const t = e.option.target;
      if (e.option.kind !== "carry") return t;
      const dx = t.x - me.x, dy = t.y - me.y;
      const d = Math.hypot(dx, dy) || 1;
      return { x: me.x + (dx / d) * 8, y: me.y + (dy / d) * 8 };
    };
    for (const e of shown) {
      const col = gradeColor(gradeOf(e));
      const t = tip(e);
      arrow(g, sx(me.y), sy(me.x), sx(t.y), sy(t.x), col, e.option.kind === "carry" ? 3 : 2.2, e.option.kind === "carry");
    }

    // Where you thought players were, linked to where they really were.
    for (const gh of r.ghostsAtDecision) {
      const real = pos.get(gh.id)!;
      g.save();
      g.setLineDash([3, 3]);
      g.strokeStyle = "rgba(255,255,255,0.75)";
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(sx(gh.y), sy(gh.x), 6, 0, Math.PI * 2);
      g.stroke();
      if (Math.hypot(real.x - gh.x, real.y - gh.y) > 1) {
        g.beginPath();
        g.moveTo(sx(gh.y), sy(gh.x));
        g.lineTo(sx(real.y), sy(real.x));
        g.stroke();
      }
      g.restore();
    }

    // Players.
    for (const e of s.all) {
      const p = pos.get(e.id)!;
      const us = e.team !== "opp";
      g.beginPath();
      g.arc(sx(p.y), sy(p.x), 7.5, 0, Math.PI * 2);
      g.fillStyle = us ? "#2f6df6" : "#ef4444";
      g.fill();
      g.lineWidth = e === s.you ? 3 : 1.4;
      g.strokeStyle = e === s.you ? "#ffe14d" : "rgba(255,255,255,0.9)";
      g.stroke();
      g.fillStyle = "#fff";
      g.font = "700 9px system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(e.number), sx(p.y), sy(p.x) + 0.5);
    }

    // Your choice on top, then the best option's star.
    if (r.choice) {
      const tgt = tip(r.choice);
      arrow(g, sx(me.y), sy(me.x), sx(tgt.y), sy(tgt.x), "#ffffff", 4);
      if (!r.choice.succeeds && r.choice.threat) {
        const at = r.choice.threat.at;
        g.strokeStyle = RED;
        g.lineWidth = 3;
        const X = sx(at.y), Y = sy(at.x);
        g.beginPath();
        g.moveTo(X - 6, Y - 6);
        g.lineTo(X + 6, Y + 6);
        g.moveTo(X + 6, Y - 6);
        g.lineTo(X - 6, Y + 6);
        g.stroke();
      }
    }
    const bt = tip(r.best);
    star(g, sx(bt.y), sy(bt.x) - 14, 8);
  }

  private drawTimeline(moment: Moment): void {
    const c = this.timeline;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = c.clientWidth || 340;
    const H = c.clientHeight || 34;
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = moment.scenario;
    const t0 = 0;
    const t1 = s.arrival + 0.15;
    const x = (t: number) => 8 + ((t - t0) / (t1 - t0)) * (W - 16);
    g.clearRect(0, 0, W, H);
    g.fillStyle = "rgba(255,255,255,0.12)";
    g.fillRect(x(t0), 14, x(t1) - x(t0), 6);
    // Ball in flight.
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.fillRect(x(moment.spec.kickAt), 14, x(s.arrival) - x(moment.spec.kickAt), 6);
    // Scans.
    for (const sc of moment.vision.scans) {
      if (sc.start > s.arrival) continue;
      g.fillStyle = "#7dd3fc";
      g.fillRect(x(sc.start), 9, Math.max(3, x(sc.start + moment.vision.scanDuration) - x(sc.start)), 16);
    }
    g.fillStyle = GOLD;
    g.fillRect(x(s.arrival) - 1.5, 6, 3, 22);
    g.fillStyle = "rgba(255,255,255,0.75)";
    g.font = "600 10px system-ui, sans-serif";
    g.textBaseline = "top";
    g.textAlign = "left";
    g.fillText("pass played", x(moment.spec.kickAt), 24);
    g.textAlign = "right";
    g.fillText("ball arrives", x(s.arrival) - 4, 24);
    g.textAlign = "left";
    g.fillText("your checks", 8, 0);
  }
}
