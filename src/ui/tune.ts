// ?tune=1: live tuning for the coach and designer. Changes apply from the next
// moment (press "Replay"); "Copy settings" gives the values back as JSON, which is
// how a round of feedback turns into a commit.

import type { Game } from "../game/game";
import type { Tuning } from "../game/moment";
import { DEFAULT_VISION } from "../sim/memory";

export async function openTuning(game: Game, tuning: Tuning): Promise<void> {
  const { default: GUI } = await import("lil-gui");
  const gui = new GUI({ title: "Tuning" });
  gui.domElement.style.zIndex = "60";
  const t = gui.addFolder("Timing");
  t.add(tuning, "decideWindow", 0.6, 4, 0.1).name("decide window (s)");
  t.add(tuning, "slowMotion", 0, 1, 0.05).name("slow motion while deciding");
  t.add(tuning, "briefTime", 0.5, 6, 0.1).name("brief (s)");
  const m = gui.addFolder("Model");
  m.add(tuning.model, "passSpeed", 8, 20, 0.5).name("short pass speed (m/s)");
  m.add(tuning.model, "passRelease", 0, 0.8, 0.05).name("touch + pass (s)");
  m.add(tuning.model, "carrySpeed", 3, 8, 0.1).name("carry speed (m/s)");
  m.add(tuning.model, "reaction", 0, 0.8, 0.05).name("defender reaction (s)");
  m.add(tuning.model, "defenderSpeed", 4, 9, 0.1).name("defender speed (m/s)");
  m.add(tuning.model, "heavyTouch", 0, 0.6, 0.05).name("heavy touch cost (s)");
  const v = gui.addFolder("Vision");
  const deg = { halfAngle: (DEFAULT_VISION.halfAngle * 180) / Math.PI, scanAngle: (DEFAULT_VISION.scanAngle * 180) / Math.PI };
  v.add(deg, "halfAngle", 15, 70, 1).name("field of view ± (deg)").onChange((x: number) => (DEFAULT_VISION.halfAngle = (x * Math.PI) / 180));
  v.add(deg, "scanAngle", 90, 180, 5).name("shoulder check (deg)").onChange((x: number) => (DEFAULT_VISION.scanAngle = (x * Math.PI) / 180));
  v.add(DEFAULT_VISION, "range", 20, 70, 1).name("read range (m)");
  gui.add({ replay: () => game.replay() }, "replay").name("Replay this moment");
  gui.add(
    {
      copy: () => {
        const json = JSON.stringify({ ...tuning, vision: DEFAULT_VISION }, null, 2);
        void navigator.clipboard?.writeText(json);
        console.info(json);
      },
    },
    "copy",
  ).name("Copy settings (JSON)");
}
