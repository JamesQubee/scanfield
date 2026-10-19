// Menus around the game: home with drills, how to play, results, progress,
// settings, the Pro paywall with a test checkout, and the analytics inspector.

import type { DrillDef, DrillRun } from "../game/game";
import type { MomentResult } from "../game/moment";
import type { ListRunsResponse, MeResponse, Plan, SaveRunResponse } from "../shared/api-types";
import { SKILLS, type Skill } from "../sim/scenario";
import { analyticsMode, onEvents, recentEvents } from "../platform/analytics";
import { gradeColor } from "./coachBoard";
import { clear, h } from "./h";

export interface ShellActions {
  play(drill: DrillDef): void;
  loadProgress(): Promise<ListRunsResponse>;
  startCheckout(): Promise<void>;
  completeCheckout(): Promise<void>;
  cancelSubscription(): Promise<void>;
  setSound(on: boolean): void;
  setEffects(on: boolean): void;
  setHaptics(on: boolean): void;
  resetPlayer(): void;
}

export interface ShellState {
  me: MeResponse | null;
  online: boolean;
  best: Record<string, number>;
  sound: boolean;
  effects: boolean;
  haptics: boolean;
  seenHowTo: boolean;
}

type Screen = "home" | "howto" | "summary" | "progress" | "settings" | "paywall" | "checkout" | "events";

const LOCK = "🔒";

let keyboardUser = false;
window.addEventListener("keydown", (e) => {
  if (e.key === "Tab") keyboardUser = true;
});
window.addEventListener("pointerdown", () => (keyboardUser = false));

export class Shell {
  readonly root: HTMLDivElement;
  private readonly screens = new Map<Screen, HTMLElement>();
  private current: Screen | null = null;
  private after: (() => void) | null = null;
  private readonly toastEl = h("div", { class: "toast", attrs: { role: "status", "aria-live": "polite" } });
  private eventsOff: (() => void) | null = null;

  constructor(
    host: HTMLElement,
    private readonly drills: DrillDef[],
    private readonly state: ShellState,
    private readonly act: ShellActions,
  ) {
    this.root = h("div", { class: "shell" });
    host.append(this.root, this.toastEl);
  }

  get plan(): Plan {
    return this.state.me?.plan ?? "free";
  }

  hide(): void {
    this.root.classList.remove("on");
    this.current = null;
    this.eventsOff?.();
    this.eventsOff = null;
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.animate([{ opacity: 0, transform: "translate(-50%, 10px)" }, { opacity: 1, transform: "translate(-50%, 0)", offset: 0.1 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], { duration: 2600, easing: "ease-out" });
  }

  private show(screen: Screen, el: HTMLElement): void {
    this.eventsOff?.();
    this.eventsOff = null;
    clear(this.root);
    this.root.append(el);
    this.root.classList.add("on");
    this.current = screen;
    this.screens.set(screen, el);
    // Move focus for keyboard users only; on touch a focus ring on the button just looks broken.
    if (keyboardUser) el.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
    this.root.scrollTop = 0;
  }

  refresh(): void {
    if (this.current === "home") this.home();
  }

  // ------------------------------------------------------------------ home

  home(): void {
    const me = this.state.me;
    const pro = this.plan === "pro";
    const cards = this.drills.map((d) => {
      const locked = d.pro && !pro;
      const best = this.state.best[d.id];
      return h(
        "button",
        {
          class: `drill${locked ? " locked" : ""}`,
          attrs: { type: "button", "data-drill": d.id, "aria-label": `${d.title}${locked ? " (Pro)" : ""}` },
          on: { click: () => (locked ? this.paywall(d) : this.startDrill(d)) },
        },
        h("div", { class: "drill-top" }, h("span", { class: "drill-title", text: d.title }), h("span", { class: `drill-badge${d.pro ? " pro" : ""}`, text: d.pro ? (locked ? `${LOCK} Pro` : "Pro") : "Free" })),
        h("div", { class: "drill-blurb", text: d.blurb }),
        h("div", { class: "drill-meta" }, `${d.scenes.length} moments`, best !== undefined ? h("span", { class: "drill-best", text: `best ${best}` }) : null),
      );
    });
    const el = h(
      "section",
      { class: "screen home" },
      h(
        "div",
        { class: "home-head" },
        h("div", { class: "logo" }, h("span", { class: "logo-mark" }), "SCANFIELD"),
        h("div", { class: "player-chip" }, me ? `${me.nickname}` : this.state.online ? "…" : "Offline", h("span", { class: `plan ${pro ? "pro" : ""}`, text: pro ? "PRO" : "FREE" })),
      ),
      h("h1", { class: "home-tag", text: "See it before you get it." }),
      h("p", { class: "home-sub", text: "Check your shoulders while the ball travels. When it arrives, tap where it goes. Players you have not checked stay where you last saw them." }),
      h("button", { class: "btn primary big", attrs: { type: "button", "data-autofocus": "" }, text: "Play: Half-turn basics", on: { click: () => this.startDrill(this.drills[0]!) } }),
      h("div", { class: "drills" }, ...cards),
      h(
        "div",
        { class: "home-links" },
        h("button", { class: "link", attrs: { type: "button" }, text: "How to play", on: { click: () => this.howto() } }),
        h("button", { class: "link", attrs: { type: "button" }, text: "Progress", on: { click: () => void this.progress() } }),
        h("button", { class: "link", attrs: { type: "button" }, text: "Settings", on: { click: () => this.settings() } }),
      ),
    );
    this.show("home", el);
  }

  private startDrill(d: DrillDef): void {
    if (!this.state.seenHowTo) {
      this.howto(() => this.act.play(d));
      return;
    }
    this.act.play(d);
  }

  // ------------------------------------------------------------------ how to play

  howto(then?: () => void): void {
    this.after = then ?? null;
    const step = (n: string, title: string, text: string) => h("li", { class: "step" }, h("span", { class: "step-n", text: n }), h("div", {}, h("b", { text: title }), h("p", { text })));
    const el = h(
      "section",
      { class: "screen howto" },
      h("h2", { text: "How to play" }),
      h(
        "ol",
        { class: "steps" },
        step("1", "Check your shoulders", "While the pass travels to you, tap Check (or swipe left or right). The bright cone on the grass is what you can see."),
        step("2", "Remember the picture", "Players outside your cone fade to where you last saw them. They keep moving, so check late, just before the ball arrives."),
        step("3", "Tap where the ball goes", "When it arrives, time slows. Tap a teammate to pass, open grass to turn and carry, or the passer to set it back."),
        step("4", "Learn from the board", "The coach board scores every option, shows where players really were, and when you scanned."),
      ),
      h("button", {
        class: "btn primary big",
        attrs: { type: "button", "data-autofocus": "" },
        text: then ? "Got it, let's play" : "Back",
        on: {
          click: () => {
            this.state.seenHowTo = true;
            const f = this.after;
            this.after = null;
            if (f) f();
            else this.home();
          },
        },
      }),
    );
    this.show("howto", el);
  }

  // ------------------------------------------------------------------ results

  summary(run: DrillRun, saving: Promise<SaveRunResponse | null>): void {
    const rs = run.results;
    const score = Math.round(rs.reduce((a, r) => a + r.grade, 0) / Math.max(1, rs.length));
    const correct = rs.filter((r) => r.correct).length;
    const reactions = rs.map((r) => r.reactionMs).filter((x): x is number => x !== null);
    const avgReact = reactions.length ? reactions.reduce((a, b) => a + b, 0) / reactions.length : null;
    const scans = rs.reduce((a, r) => a + r.scans, 0) / Math.max(1, rs.length);
    let streak = 0;
    let best = 0;
    for (const r of rs) {
      streak = r.correct ? streak + 1 : 0;
      best = Math.max(best, streak);
    }
    const latency = rs.map((r) => r.inputToFrameMs).filter((x): x is number => x !== null).sort((a, b) => a - b);
    const saveEl = h("div", { class: "save-state", text: "Saving to your progress…" });
    saving.then(
      (res) => {
        saveEl.textContent = res ? "Saved to your progress ✓" : "Offline: saved on this device, will sync later";
        saveEl.classList.add(res ? "ok" : "warn");
      },
      () => {
        saveEl.textContent = "Could not save right now; it will retry";
        saveEl.classList.add("warn");
      },
    );
    const next = this.drills[(this.drills.indexOf(run.drill) + 1) % this.drills.length]!;
    const nextLocked = next.pro && this.plan !== "pro";
    const el = h(
      "section",
      { class: "screen summary" },
      h("div", { class: "summary-kicker", text: run.drill.title }),
      h("div", { class: "summary-score", style: { color: gradeColor(score) } }, String(score)),
      h("div", { class: "summary-caption", text: score >= 85 ? "Great picture. You saw it first." : score >= 60 ? "Good. Check later, just before it arrives." : "Keep checking: the picture changes while the ball travels." }),
      h(
        "div",
        { class: "stats" },
        stat(`${correct}/${rs.length}`, "best choice"),
        stat(avgReact === null ? "—" : `${(avgReact / 1000).toFixed(2)}s`, "to decide"),
        stat(scans.toFixed(1), "checks per ball"),
        stat(String(best), "best streak"),
      ),
      h("ol", { class: "moment-list" }, ...rs.map((r) => momentRow(r))),
      saveEl,
      latency.length ? h("div", { class: "tech-note", text: `Tap response: median ${latency[Math.floor(latency.length / 2)]!.toFixed(0)} ms from touch to the frame that answers it.` }) : null,
      h(
        "div",
        { class: "row" },
        h("button", { class: "btn", attrs: { type: "button" }, text: "Home", on: { click: () => this.home() } }),
        h("button", { class: "btn", attrs: { type: "button" }, text: "Play again", on: { click: () => this.act.play(run.drill) } }),
      ),
      h("button", {
        class: "btn primary big",
        attrs: { type: "button", "data-autofocus": "" },
        text: nextLocked ? `${LOCK} Unlock ${next.title}` : `Next: ${next.title}`,
        on: { click: () => (nextLocked ? this.paywall(next) : this.act.play(next)) },
      }),
    );
    this.show("summary", el);
  }

  // ------------------------------------------------------------------ progress

  async progress(): Promise<void> {
    const body = h("div", { class: "progress-body", text: "Loading…" });
    const el = h("section", { class: "screen progress" }, h("h2", { text: "Progress" }), body, h("button", { class: "btn big", attrs: { type: "button" }, text: "Back", on: { click: () => this.home() } }));
    this.show("progress", el);
    try {
      const data = await this.act.loadProgress();
      if (this.current !== "progress") return;
      clear(body);
      if (!data.runs.length) {
        body.append(h("p", { class: "muted", text: "No drills played yet. Your runs are saved here after each drill." }));
        return;
      }
      const spark = h("canvas", { class: "spark", attrs: { role: "img", "aria-label": "Scores of your recent drills" } });
      body.append(
        h("h3", { text: "By skill" }),
        h(
          "div",
          { class: "skills" },
          ...data.skills.map((s) =>
            h(
              "div",
              { class: "skill" },
              h("div", { class: "skill-name", text: SKILLS[s.skill as Skill] ?? s.skill }),
              h("div", { class: "skill-bar" }, h("div", { class: "skill-fill", style: { width: `${s.avgGrade}%`, background: gradeColor(s.avgGrade) } })),
              h("div", { class: "skill-num", text: `${s.avgGrade}` }),
            ),
          ),
        ),
        h("h3", { text: "Recent drills" }),
        spark,
        h(
          "ol",
          { class: "run-list" },
          ...data.runs.map((r) =>
            h(
              "li",
              {},
              h("span", { class: "run-name", text: this.drills.find((d) => d.id === r.drillId)?.title ?? r.drillId }),
              h("span", { class: "run-meta", text: `${r.correctCount}/${r.momentsCount} · ${new Date(r.finishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` }),
              h("span", { class: "run-score", style: { color: gradeColor(r.score) }, text: String(r.score) }),
            ),
          ),
        ),
      );
      requestAnimationFrame(() => drawSpark(spark, [...data.runs].reverse().map((r) => r.score)));
    } catch {
      body.textContent = "Progress needs a connection. Your drills are kept on this device until then.";
    }
  }

  // ------------------------------------------------------------------ settings

  settings(): void {
    const toggle = (label: string, on: boolean, set: (v: boolean) => void) => {
      const input = h("input", { attrs: { type: "checkbox", role: "switch" } });
      input.checked = on;
      input.addEventListener("change", () => set(input.checked));
      return h("label", { class: "toggle" }, h("span", { text: label }), input);
    };
    const pro = this.plan === "pro";
    const el = h(
      "section",
      { class: "screen settings" },
      h("h2", { text: "Settings" }),
      toggle("Sound", this.state.sound, (v) => this.act.setSound(v)),
      toggle("Vibration (Android)", this.state.haptics, (v) => this.act.setHaptics(v)),
      toggle("Camera shake and confetti", this.state.effects, (v) => this.act.setEffects(v)),
      h("div", { class: "settings-group" }, h("h3", { text: "Account" }), h("p", { class: "muted", text: `Playing as ${this.state.me?.nickname ?? "a guest"}. No email or sign-up needed for this demo.` }), h("p", { class: "muted", text: pro ? `Plan: Pro (test subscription${this.state.me?.subscription?.renewsAt ? `, renews ${new Date(this.state.me.subscription.renewsAt).toLocaleDateString("en-GB")}` : ""})` : "Plan: Free" })),
      pro
        ? h("button", { class: "btn", attrs: { type: "button" }, text: "Cancel test subscription", on: { click: () => void this.act.cancelSubscription() } })
        : h("button", { class: "btn primary", attrs: { type: "button" }, text: "See Pro", on: { click: () => this.paywall(null) } }),
      h("div", { class: "settings-group" }, h("h3", { text: "For the team" }), h("p", { class: "muted", text: `Analytics: ${analyticsMode === "posthog" ? "PostHog (via /ingest)" : "local only, no key set"}.` })),
      h("button", { class: "btn", attrs: { type: "button" }, text: "Analytics events", on: { click: () => this.events() } }),
      h("button", { class: "btn ghost", attrs: { type: "button" }, text: "Start over as a new player", on: { click: () => this.act.resetPlayer() } }),
      h("button", { class: "btn big", attrs: { type: "button", "data-autofocus": "" }, text: "Back", on: { click: () => this.home() } }),
    );
    this.show("settings", el);
  }

  // ------------------------------------------------------------------ payments

  paywall(drill: DrillDef | null): void {
    const el = h(
      "section",
      { class: "screen paywall" },
      h("div", { class: "pro-mark", text: "PRO" }),
      h("h2", { text: drill ? `Unlock ${drill.title}` : "Scanfield Pro" }),
      h("ul", { class: "perks" }, h("li", { text: "Every drill, including Back to goal" }), h("li", { text: "New moments every month" }), h("li", { text: "Progress by skill for player and coach" })),
      h("p", { class: "muted small", text: "Payments run through Lemon Squeezy. This demo is in test mode: no card, no charge." }),
      h("button", { class: "btn primary big", attrs: { type: "button", "data-autofocus": "" }, text: "Start test checkout", on: { click: () => void this.act.startCheckout() } }),
      h("button", { class: "btn big", attrs: { type: "button" }, text: "Not now", on: { click: () => this.home() } }),
    );
    this.show("paywall", el);
  }

  /** The demo stand-in for Lemon Squeezy's hosted checkout. */
  demoCheckout(): void {
    const el = h(
      "section",
      { class: "screen checkout" },
      h("div", { class: "checkout-badge", text: "TEST MODE" }),
      h("h2", { text: "Scanfield Pro · yearly" }),
      h("p", { class: "muted", text: "This stands in for the Lemon Squeezy checkout. When you complete it, the server signs a subscription_created webhook with the shop's secret and sends it through the same handler a real Lemon Squeezy delivery uses. Your plan changes only when that webhook is verified." }),
      h("div", { class: "checkout-line" }, h("span", { text: "Scanfield Pro (12 months)" }), h("b", { text: "test" })),
      h("button", {
        class: "btn primary big",
        attrs: { type: "button", "data-autofocus": "" },
        text: "Complete test purchase",
        on: {
          click: (e) => {
            (e.currentTarget as HTMLButtonElement).disabled = true;
            void this.act.completeCheckout();
          },
        },
      }),
      h("button", { class: "btn big", attrs: { type: "button" }, text: "Cancel", on: { click: () => this.home() } }),
    );
    this.show("checkout", el);
  }

  // ------------------------------------------------------------------ analytics inspector

  events(): void {
    const list = h("ol", { class: "events" });
    const render = () => {
      list.replaceChildren(
        ...recentEvents().map((e) =>
          h(
            "li",
            {},
            h("div", { class: "ev-head" }, h("b", { text: e.name }), h("span", { class: "muted", text: new Date(e.at).toLocaleTimeString("en-GB") })),
            h("code", { text: Object.entries(e.props).map(([k, v]) => `${k}=${v}`).join("  ") }),
          ),
        ),
      );
    };
    render();
    const el = h(
      "section",
      { class: "screen events-screen" },
      h("h2", { text: "Analytics events" }),
      h("p", { class: "muted small", text: analyticsMode === "posthog" ? "Sent to PostHog through the Worker's /ingest proxy." : "No PostHog key is set, so events stay on this device. With a key, the same events go to PostHog." }),
      list,
      h("button", { class: "btn big", attrs: { type: "button", "data-autofocus": "" }, text: "Back", on: { click: () => this.settings() } }),
    );
    this.show("events", el);
    this.eventsOff = onEvents(render);
  }
}

function stat(value: string, label: string): HTMLElement {
  return h("div", { class: "stat-card" }, h("b", { text: value }), h("span", { text: label }));
}

function momentRow(r: MomentResult): HTMLElement {
  const what = r.timeout ? "No decision" : r.choice!.option.label;
  return h("li", {}, h("span", { class: "m-title", text: r.title }), h("span", { class: "m-what", text: what }), h("span", { class: "m-grade", style: { background: gradeColor(r.grade) }, text: String(r.grade) }));
}

function drawSpark(c: HTMLCanvasElement, values: number[]): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = c.clientWidth || 300;
  const H = c.clientHeight || 70;
  c.width = W * dpr;
  c.height = H * dpr;
  const g = c.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const n = values.length;
  const x = (i: number) => (n === 1 ? W / 2 : 8 + (i / (n - 1)) * (W - 16));
  const y = (v: number) => H - 8 - (v / 100) * (H - 16);
  g.strokeStyle = "rgba(255,255,255,0.15)";
  g.beginPath();
  g.moveTo(0, y(50));
  g.lineTo(W, y(50));
  g.stroke();
  g.strokeStyle = "#ffd23f";
  g.lineWidth = 2.5;
  g.beginPath();
  values.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v))));
  g.stroke();
  values.forEach((v, i) => {
    g.fillStyle = gradeColor(v);
    g.beginPath();
    g.arc(x(i), y(v), 4, 0, Math.PI * 2);
    g.fill();
  });
}
