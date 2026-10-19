// A drill: several moments in a row. Kept free of DOM and WebGL so tests can use it.

import type { ScenarioSpec } from "../sim/scenario";
import type { MomentResult } from "./moment";

export interface DrillDef {
  id: string;
  title: string;
  blurb: string;
  scenes: string[];
  pro: boolean;
}

export interface DrillRun {
  id: string;
  drill: DrillDef;
  specs: ScenarioSpec[];
  index: number;
  results: MomentResult[];
  startedAt: number;
}

/** Records a moment's result. "Try again" replaces the attempt instead of adding one. */
export function recordResult(run: DrillRun, r: MomentResult): void {
  run.results[run.index] = r;
  run.results.length = Math.min(run.results.length, run.index + 1);
}
