import "./ui/styles.css";
import { Clock } from "./core/clock";
import { FLAGS } from "./flags";
import { CONTENT_VERSION, DRILLS, SCENARIOS, specsFor } from "./game/content";
import { Game, type DrillDef, type DrillRun } from "./game/game";
import { DEFAULT_TUNING } from "./game/moment";
import { toScreen } from "./input/pick";
import { evaluateAll } from "./eval/evaluate";
import { deviceClass, identify, track } from "./platform/analytics";
import { Api } from "./platform/api";
import { setSoundEnabled, unlockAudio } from "./platform/audio";
import { setHaptics } from "./platform/haptics";
import { load, save } from "./platform/storage";
import { warmUp } from "./render/warmup";
import type { RunPayload, SaveRunResponse } from "./shared/api-types";
import { h } from "./ui/h";
import { Shell, type ShellState } from "./ui/shell";

const app = document.getElementById("app")!;
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

interface Settings {
  sound: boolean;
  haptics: boolean;
  effects: boolean | null;
  seenHowTo: boolean;
}
const settings = load<Settings>("sf.settings", { sound: true, haptics: true, effects: null, seenHowTo: false });
const effectsOn = () => (FLAGS.animations === "on" ? true : FLAGS.animations === "off" ? false : settings.effects ?? !reduced.matches);
setSoundEnabled(settings.sound);
setHaptics(settings.haptics);

const tuning = { ...DEFAULT_TUNING, model: { ...DEFAULT_TUNING.model } };
const game = new Game(app, {
  clock: new Clock(FLAGS.capture ? "stepped" : "live"),
  debug: FLAGS.debug,
  calm: () => !effectsOn(),
  tuning,
});
const api = new Api();
const best = load<Record<string, number>>("sf.best", {});
const state: ShellState = {
  me: null,
  online: navigator.onLine,
  best,
  sound: settings.sound,
  effects: effectsOn(),
  haptics: settings.haptics,
  seenHowTo: settings.seenHowTo,
};
const persist = () => save("sf.settings", { ...settings, seenHowTo: state.seenHowTo });
let demoSession: string | null = null;

const single = FLAGS.scene ? SCENARIOS.get(FLAGS.scene) ?? null : null;
const backdrop = single ?? SCENARIOS.get("ht-01-marker-leaves")!;
game.showBackdrop(backdrop);
void warmUp(game, backdrop);
if (!FLAGS.capture) game.start();

const shell = new Shell(app, DRILLS, state, {
  play: (d) => play(d),
  loadProgress: () => api.runs(),
  startCheckout: async () => {
    track("checkout_started", { plan: shell.plan });
    try {
      const res = await api.checkout();
      if (res.mode === "demo") {
        demoSession = res.sessionId;
        shell.demoCheckout();
      } else {
        location.href = res.url;
      }
    } catch {
      shell.toast("Checkout is not available right now");
    }
  },
  completeCheckout: async () => {
    if (!demoSession) return;
    try {
      await api.completeDemoCheckout(demoSession);
      demoSession = null;
      state.me = await api.me();
      track("checkout_completed", { plan: state.me.plan });
      shell.toast(state.me.plan === "pro" ? "Pro unlocked: webhook verified ✓" : "Payment received, waiting for confirmation");
      shell.home();
    } catch {
      shell.toast("That did not go through. Try again.");
      shell.home();
    }
  },
  cancelSubscription: async () => {
    try {
      await api.cancelDemoSubscription();
      state.me = await api.me();
      track("subscription_cancelled", { plan: state.me.plan });
      shell.toast("Test subscription cancelled");
      shell.settings();
    } catch {
      shell.toast("Could not cancel right now");
    }
  },
  setSound: (on) => {
    settings.sound = state.sound = on;
    setSoundEnabled(on);
    persist();
  },
  setEffects: (on) => {
    settings.effects = state.effects = on;
    persist();
  },
  setHaptics: (on) => {
    settings.haptics = state.haptics = on;
    setHaptics(on);
    persist();
  },
  resetPlayer: () => {
    api.forget();
    state.me = null;
    void signIn().then(() => shell.home());
  },
});

function play(d: DrillDef): void {
  unlockAudio();
  persist();
  shell.hide();
  track("drill_started", { drill: d.id });
  game.playDrill(d, specsFor(d));
}

function runPayload(run: DrillRun): RunPayload {
  return {
    id: run.id,
    drillId: run.drill.id,
    contentVersion: CONTENT_VERSION,
    startedAt: run.startedAt,
    finishedAt: Date.now(),
    deviceClass: deviceClass(),
    moments: run.results.map((r, idx) => ({
      idx,
      sceneId: r.sceneId,
      skill: r.skill,
      choiceKind: r.choice ? r.choice.option.kind : "timeout",
      choiceId: r.choice ? r.choice.option.id : null,
      bestId: r.best.option.id,
      grade: r.grade,
      correct: r.correct,
      reactionMs: r.reactionMs,
      scans: r.scans,
      lastScanBeforeArrivalMs: r.lastScanBeforeArrivalMs,
      inputToFrameMs: r.inputToFrameMs === null ? null : Math.round(r.inputToFrameMs * 10) / 10,
    })),
  };
}

game.events.momentDone = (r, run) => {
  track("moment_decided", {
    drill: run?.drill.id ?? "single",
    scene: r.sceneId,
    skill: r.skill,
    choice: r.choice?.option.kind ?? "timeout",
    correct: r.correct,
    grade: r.grade,
    blind: r.blind,
    reaction_ms: r.reactionMs,
    scans: r.scans,
    last_scan_ms: r.lastScanBeforeArrivalMs,
    input_to_frame_ms: r.inputToFrameMs === null ? null : Math.round(r.inputToFrameMs),
    device: deviceClass(),
  });
};

game.events.drillDone = (run) => {
  const score = Math.round(run.results.reduce((a, r) => a + r.grade, 0) / run.results.length);
  best[run.drill.id] = Math.max(best[run.drill.id] ?? 0, score);
  save("sf.best", best);
  track("drill_completed", { drill: run.drill.id, score, correct: run.results.filter((r) => r.correct).length, moments: run.results.length });
  const saving: Promise<SaveRunResponse | null> = api.saveRun(runPayload(run)).catch(() => null);
  shell.summary(run, saving);
};

game.events.menu = () => (single ? sceneCard() : shell.home());

async function signIn(): Promise<void> {
  try {
    const p = await api.ensurePlayer();
    identify(p.id);
    state.me = await api.me();
    state.online = true;
    void api.flush();
  } catch {
    state.online = false;
  }
  shell.refresh();
}

/** ?scene=<id>: one scene, straight in. The shape of the paid-trial deliverable. */
function sceneCard(): void {
  const spec = single!;
  const card = h(
    "div",
    { class: "shell on" },
    h(
      "section",
      { class: "screen scene-card" },
      h("div", { class: "logo" }, h("span", { class: "logo-mark" }), "SCANFIELD"),
      h("div", { class: "muted small", text: `Scene · ${spec.id} · v${spec.version}` }),
      h("h2", { text: spec.title }),
      h("p", { text: spec.brief }),
      h("button", {
        class: "btn primary big",
        attrs: { type: "button", "data-autofocus": "" },
        text: "Tap to start",
        on: {
          click: () => {
            unlockAudio();
            card.remove();
            game.playScene(spec);
          },
        },
      }),
    ),
  );
  app.append(card);
}

window.addEventListener("online", () => void signIn());
track("app_open", { device: deviceClass(), mode: single ? "scene" : "app", dpr: Math.round(devicePixelRatio * 100) / 100 });
if (single) sceneCard();
else shell.home();
void signIn();

if (FLAGS.tune) void import("./ui/tune").then((m) => m.openTuning(game, tuning));
if (FLAGS.drill && !single) {
  const d = DRILLS.find((x) => x.id === FLAGS.drill);
  if (d) {
    state.seenHowTo = true;
    play(d);
  }
}

// Test and recording hooks (harmless in production: read-only helpers plus a frame stepper).
declare global {
  interface Window {
    __game: unknown;
  }
}
window.__game = {
  game,
  shell,
  api,
  step: (n = 1) => {
    for (let i = 0; i < n; i++) game.frame();
  },
  /** Where to tap for the best option right now (the game's own evaluator; for tests and the recorder). */
  bestTarget: () => {
    const m = game.moment;
    if (!m) return null;
    const d = evaluateAll(m.scenario, m.tau, { params: m.tuning.model, extraDelay: m.heavyTouch ? m.tuning.model.heavyTouch : 0 });
    const best = d.best.option;
    const drawn = best.mateId ? game.world.targets.find((q) => q.id === best.mateId) : null;
    return drawn ? { x: drawn.x, y: drawn.y, id: best.id } : { x: best.target.x, y: best.target.y, id: best.id };
  },
  /** Pitch metres to page coordinates, using the last frame on screen. */
  toScreen: (x: number, y: number) => {
    const r = game.stage.canvas.getBoundingClientRect();
    const p = toScreen(game.stage.frame, x, y, 0.9, { x: 0, y: 0 });
    return { x: p.x + r.left, y: p.y + r.top };
  },
};
