import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ScenarioSpec } from "../../src/sim/scenario";

const dir = path.resolve(import.meta.dirname, "../../scenarios");

export function loadSpecs(): ScenarioSpec[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as ScenarioSpec);
}
