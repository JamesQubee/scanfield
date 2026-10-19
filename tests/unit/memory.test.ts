import { describe, expect, it } from "vitest";
import { Vision } from "../../src/sim/memory";
import { buildScenario, type ScenarioSpec } from "../../src/sim/scenario";

// You at (50, 34) facing the passer at (30, 34) (towards x = 0).
// "ahead" stands in front of you, "behind" behind you, "close" right on your back,
// "crosser" runs across your view quickly.
const spec: ScenarioSpec = {
  id: "mem",
  version: 1,
  title: "t",
  skill: "half-turn",
  brief: "b",
  coach: { why: "w", tip: "t" },
  intendedBest: "setback",
  scanRequired: false,
  timed: false,
  kickAt: 1,
  passSpeed: 10,
  you: { id: "you", number: 6, path: [[0, 50, 34]] },
  passer: "m4",
  teammates: [{ id: "m4", number: 4, path: [[0, 30, 34]] }],
  opponents: [
    { id: "ahead", number: 9, path: [[0, 40, 36]] },
    { id: "behind", number: 8, path: [[0, 62, 30]] },
    { id: "close", number: 5, path: [[0, 51.2, 34]] },
    { id: "far", number: 3, path: [[0, 2, 34]] },
  ],
};

describe("vision", () => {
  it("sees what is in front, feels who is on your back, misses what is behind or too far", () => {
    const v = new Vision(buildScenario(spec));
    v.seedAll(0);
    v.step(0.5);
    expect(v.isLive("ahead")).toBe(true);
    expect(v.isLive("close")).toBe(true);
    expect(v.isLive("behind")).toBe(false);
    expect(v.isLive("far")).toBe(false);
  });

  it("a shoulder check reveals the player behind and records when", () => {
    const v = new Vision(buildScenario(spec));
    v.seedAll(0);
    v.step(0.5);
    // Try both sides: the one that turns towards (62, 30) must see him.
    let seen = false;
    for (const side of [1, -1] as const) {
      const w = new Vision(buildScenario(spec));
      w.seedAll(0);
      w.step(0.5);
      w.startScan(side, 0.5);
      w.step(0.5 + w.scanDuration);
      if (w.memory.get("behind")!.t > 0.5) seen = true;
    }
    expect(seen).toBe(true);
  });

  it("does not start a second scan while one is running", () => {
    const v = new Vision(buildScenario(spec));
    expect(v.startScan(1, 0.5)).toBe(true);
    expect(v.startScan(-1, 0.6)).toBe(false);
    expect(v.startScan(-1, 0.5 + v.scanDuration + 0.01)).toBe(true);
  });

  it("turns the head out to 150 degrees and back in a third of a second", () => {
    const v = new Vision(buildScenario(spec));
    v.startScan(1, 1);
    expect(v.scanOffset(1)).toBe(0);
    expect(v.scanOffset(1 + v.params.scanOut + 0.05)).toBeCloseTo(v.params.scanAngle, 6);
    expect(v.scanOffset(1 + v.scanDuration + 0.001)).toBe(0);
    expect(v.scanDuration).toBeCloseTo(0.33, 6);
  });

  it("gives the same knowledge at 30 fps and at 240 fps", () => {
    const run = (dt: number) => {
      const v = new Vision(buildScenario(spec));
      v.seedAll(0);
      v.startScan(-1, 0.4);
      v.startScan(1, 0.9);
      for (let t = 0; t <= 2; t += dt) v.step(t);
      v.step(2);
      return [...v.memory.entries()].map(([id, m]) => [id, m.live, Math.round(m.t * 1000)]);
    };
    expect(run(1 / 30)).toEqual(run(1 / 240));
  });

  it("knows when you last scanned and whether you were looking away when the ball arrived", () => {
    const s = buildScenario(spec);
    const v = new Vision(s);
    v.seedAll(0);
    expect(v.lastScanBeforeArrival()).toBeNull();
    v.startScan(1, s.arrival - 1);
    expect(v.lastScanBeforeArrival()).toBeCloseTo(1 - v.scanDuration, 6);
    expect(v.headTurnedAtArrival()).toBe(false);
    v.startScan(-1, s.arrival - 0.1);
    expect(v.headTurnedAtArrival()).toBe(true);
    expect(v.scansBeforeArrival()).toBe(2);
  });
});
