// Keeps the authored scenarios and the evaluator consistent: if a coach's spec and
// the model disagree, these tests say which scenario and by how much.
import { describe, expect, it } from "vitest";
import { rng } from "../../src/core/rng";
import { evaluateAll, matchesIntended } from "../../src/eval/evaluate";
import { DEFAULT_PARAMS } from "../../src/eval/model";
import { Vision } from "../../src/sim/memory";
import { buildScenario, validateSpec, type ScenarioSpec } from "../../src/sim/scenario";
import { loadSpecs } from "./load-scenarios";

const specs = loadSpecs();
// The decision window is 1.5 s of real time at quarter speed.
const WINDOW = [0, 0.1, 0.2, 0.3, 0.375];
const MIN_MARGIN = 0.002;

function intendedMargin(spec: ScenarioSpec, t: number, params = DEFAULT_PARAMS): number {
  const s = buildScenario(spec);
  const d = evaluateAll(s, t, { params });
  let intended = -Infinity;
  let other = -Infinity;
  for (const c of d.candidates) {
    if (matchesIntended(spec.intendedBest, c.option.id)) intended = Math.max(intended, c.ev);
    else other = Math.max(other, c.ev);
  }
  return intended - other;
}

function jitter(spec: ScenarioSpec, r: () => number, metres: number): ScenarioSpec {
  const copy = structuredClone(spec);
  const move = (k: [number, number, number]) => {
    k[1] = Math.min(104.5, Math.max(0.5, k[1] + (r() * 2 - 1) * metres));
    k[2] = Math.min(67.5, Math.max(0.5, k[2] + (r() * 2 - 1) * metres));
  };
  for (const e of [...copy.teammates, ...copy.opponents]) e.path.forEach(move);
  return copy;
}

it("has ten scenarios with unique ids", () => {
  expect(specs.length).toBeGreaterThanOrEqual(10);
  expect(new Set(specs.map((s) => s.id)).size).toBe(specs.length);
});

describe.each(specs.map((s) => [s.id, s] as const))("%s", (_id, spec) => {
  it("validates", () => {
    expect(() => validateSpec(spec)).not.toThrow();
  });

  it("ranks the intended option first across the whole decision window", () => {
    const s = buildScenario(spec);
    for (const dt of WINDOW) expect(intendedMargin(spec, s.arrival + dt), `at +${dt}s`).toBeGreaterThan(MIN_MARGIN);
  });

  it("the intended option actually works across the whole decision window", () => {
    // Ranking first is not enough: if it is cut out, a perfect read scores like a mistake.
    const s = buildScenario(spec);
    for (const dt of WINDOW) {
      const d = evaluateAll(s, s.arrival + dt);
      const intended = d.candidates.filter((c) => matchesIntended(spec.intendedBest, c.option.id)).sort((a, b) => b.ev - a.ev)[0]!;
      expect(intended.succeeds, `at +${dt}s`).toBe(true);
      expect(intended.threat?.margin ?? Infinity, `margin at +${dt}s`).toBeGreaterThan(0.05);
    }
  });

  it("stays first when positions and speeds are nudged (at least 80% of 50 runs)", () => {
    const r = rng(spec.id.length * 7919);
    let ok = 0;
    for (let i = 0; i < 50; i++) {
      const nudged = jitter(spec, r, 0.75);
      const scale = () => 1 + (r() * 2 - 1) * 0.1;
      const params = { ...DEFAULT_PARAMS, passSpeed: DEFAULT_PARAMS.passSpeed * scale(), defenderSpeed: DEFAULT_PARAMS.defenderSpeed * scale() };
      const s = buildScenario(nudged);
      if (intendedMargin(nudged, s.arrival + 0.1, params) > 0) ok++;
    }
    expect(ok).toBeGreaterThanOrEqual(40);
  });

  it.runIf(spec.scanRequired)("hides the key player unless you check your shoulder late", () => {
    const s = buildScenario(spec);
    const key = spec.keyEntity!;
    // Without a scan, the key player is never seen once play starts.
    const blind = new Vision(s);
    blind.seedAll(0);
    let seenWithoutScan = false;
    for (let t = 0.05; t <= s.arrival; t += 0.05) {
      blind.step(t);
      if (blind.isLive(key)) seenWithoutScan = true;
    }
    expect(seenWithoutScan).toBe(false);
    // With one scan in the last 1.5 s, on the right side, he is seen.
    let seenWithScan = false;
    for (const side of [1, -1] as const) {
      for (let start = s.arrival - 1.5; start <= s.arrival - 0.35; start += 0.1) {
        const v = new Vision(s);
        v.seedAll(0);
        v.step(start);
        v.startScan(side, start);
        v.step(start + v.scanDuration);
        if (v.memory.get(key)!.t >= start) seenWithScan = true;
      }
    }
    expect(seenWithScan).toBe(true);
  });
});
