import "./ui/styles.css";
import { Clock } from "./core/clock";
import { FLAGS } from "./flags";
import { DRILLS, SCENARIOS, specsFor } from "./game/content";
import { Game } from "./game/game";
import { DEFAULT_TUNING } from "./game/moment";
import { unlockAudio } from "./platform/audio";
import { warmUp } from "./render/warmup";
import { h } from "./ui/h";
import { toScreen } from "./input/pick";

const app = document.getElementById("app")!;
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
const game = new Game(app, {
  clock: new Clock(FLAGS.capture ? "stepped" : "live"),
  debug: FLAGS.debug,
  calm: () => (FLAGS.animations === "on" ? false : FLAGS.animations === "off" ? true : reduced.matches),
  tuning: { ...DEFAULT_TUNING },
});

const first = SCENARIOS.get(FLAGS.scene ?? "") ?? SCENARIOS.get("ht-01-marker-leaves")!;
game.showBackdrop(first);
warmUp(game, first);
if (!FLAGS.capture) game.start();

// Minimal start screen until the full shell is in.
const start = h(
  "div",
  { class: "boot" },
  h("div", { class: "boot-logo", text: "SCANFIELD" }),
  h("div", { class: "boot-tag", text: "See it before you get it." }),
  ...(FLAGS.scene
    ? [h("button", { class: "btn primary", text: "Tap to start", on: { click: () => go(() => game.playScene(first)) } })]
    : DRILLS.map((d) => h("button", { class: "btn primary", text: d.title, on: { click: () => go(() => game.playDrill(d, specsFor(d))) } }))),
);
app.append(start);

function go(f: () => void): void {
  unlockAudio();
  start.remove();
  f();
}

game.events.menu = () => app.append(start);
game.events.drillDone = () => app.append(start);

declare global {
  interface Window {
    __game: unknown;
  }
}
window.__game = {
  game,
  step: (n = 1) => {
    for (let i = 0; i < n; i++) game.frame();
  },
  /** Pitch metres to page coordinates, using the last frame on screen. */
  toScreen: (x: number, y: number) => {
    const r = game.stage.canvas.getBoundingClientRect();
    const p = toScreen(game.stage.frame, x, y, 0.9, { x: 0, y: 0 });
    return { x: p.x + r.left, y: p.y + r.top };
  },
};
