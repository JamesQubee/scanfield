// Scenario files and the drills built from them. Adding a scenario is adding a JSON
// file; adding a drill is one entry here.

import { PRO_DRILL_IDS } from "../shared/plans";
import { validateSpec, type ScenarioSpec } from "../sim/scenario";
import type { DrillDef } from "./game";

const files = import.meta.glob<ScenarioSpec>("../../scenarios/*.json", { eager: true, import: "default" });

export const SCENARIOS = new Map<string, ScenarioSpec>();
for (const spec of Object.values(files)) {
  validateSpec(spec);
  SCENARIOS.set(spec.id, spec);
}

export const DRILLS: DrillDef[] = [
  {
    id: "half-turn-basics",
    title: "Half-turn basics",
    blurb: "Check your shoulder while the ball travels, then turn or play safe.",
    scenes: ["ht-01-marker-leaves", "ht-02-still-there", "ht-03-away-from-pressure", "pf-01-through-the-lines", "ht-04-other-shoulder", "bg-03-lane-closes"],
    pro: PRO_DRILL_IDS.includes("half-turn-basics"),
  },
  {
    id: "play-forward",
    title: "Play forward",
    blurb: "Find the free player behind you: between the lines, in behind, far side.",
    scenes: ["pf-01-through-the-lines", "pf-02-run-in-behind", "ht-01-marker-leaves", "pf-03-far-side", "bg-02-bounce-wide"],
    pro: PRO_DRILL_IDS.includes("play-forward"),
  },
  {
    id: "back-to-goal",
    title: "Back to goal",
    blurb: "Pressed from behind: set it back, bounce it wide or spot the lane closing.",
    scenes: ["bg-01-pressed-from-behind", "bg-02-bounce-wide", "ht-02-still-there", "bg-03-lane-closes", "pf-02-run-in-behind"],
    pro: PRO_DRILL_IDS.includes("back-to-goal"),
  },
];

/** Changes whenever a scenario changes, so saved runs say which content they were played on. */
export const CONTENT_VERSION = [...SCENARIOS.values()]
  .map((s) => `${s.id}@${s.version}`)
  .sort()
  .join(",")
  .split("")
  .reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7)
  .toString(36);

export function specsFor(drill: DrillDef): ScenarioSpec[] {
  return drill.scenes.map((id) => {
    const s = SCENARIOS.get(id);
    if (!s) throw new Error(`Drill ${drill.id} names unknown scenario ${id}`);
    return s;
  });
}
