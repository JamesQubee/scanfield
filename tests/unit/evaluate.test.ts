import { describe, expect, it } from "vitest";
import { evalPass, evaluateAll, gradeChoice, passSpeedFor } from "../../src/eval/evaluate";
import { DEFAULT_PARAMS } from "../../src/eval/model";
import { oppValueAt, valueAt } from "../../src/eval/value";
import { buildScenario, type ScenarioSpec } from "../../src/sim/scenario";

/** You at (40, 34) receiving from the 4 at (28, 34); a 10 ahead at (60, 34); one defender we move around. */
function spec(defender: [number, number]): ScenarioSpec {
  return {
    id: "unit",
    version: 1,
    title: "t",
    skill: "play-forward",
    brief: "b",
    coach: { why: "w", tip: "t" },
    intendedBest: "pass:m10",
    scanRequired: false,
    timed: true,
    kickAt: 1,
    passSpeed: 12,
    you: { id: "you", number: 6, path: [[0, 40, 34]] },
    passer: "m4",
    teammates: [
      { id: "m4", number: 4, path: [[0, 28, 34]] },
      { id: "m10", number: 10, path: [[0, 60, 34]] },
    ],
    opponents: [{ id: "o1", number: 1, path: [[0, defender[0], defender[1]]] }],
  };
}

function passTo10(defender: [number, number]) {
  const s = buildScenario(spec(defender));
  return evalPass(s, s.arrival, s.byId.get("m10")!);
}

describe("pass model", () => {
  it("never makes a pass safer when a defender moves closer to the line", () => {
    let prev = -1;
    for (let off = 0; off <= 15; off += 0.5) {
      const p = passTo10([50, 34 + off]).p;
      expect(p).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = p;
    }
  });

  it("cuts a pass when a defender stands on the line, and lets it through when he is far away", () => {
    expect(passTo10([50, 34.5]).succeeds).toBe(false);
    expect(passTo10([50, 60]).succeeds).toBe(true);
    expect(passTo10([50, 60]).p).toBeGreaterThan(0.95);
  });

  it("keeps the animation outcome consistent with the board (cut means margin < 0)", () => {
    for (let off = 0; off <= 12; off += 0.25) {
      const e = passTo10([50, 34 + off]);
      expect(e.succeeds).toBe(e.threat!.margin >= 0);
    }
  });

  it("does not let a marker on your back intercept at your feet", () => {
    // Defender 1 m behind you (on the 10's side): the first metre of the pass is shielded.
    const e = passTo10([41.2, 34.6]);
    expect(e.threat!.at.x).toBeGreaterThan(40.9);
  });

  it("hits longer passes harder, up to a cap", () => {
    expect(passSpeedFor(5, DEFAULT_PARAMS)).toBeLessThan(passSpeedFor(25, DEFAULT_PARAMS));
    expect(passSpeedFor(200, DEFAULT_PARAMS)).toBe(DEFAULT_PARAMS.passSpeedMax);
  });
});

describe("zone value", () => {
  it("grows towards the opponent goal and is mirrored for them", () => {
    expect(valueAt({ x: 80, y: 34 })).toBeGreaterThan(valueAt({ x: 50, y: 34 }));
    expect(valueAt({ x: 50, y: 34 })).toBeGreaterThan(valueAt({ x: 20, y: 34 }));
    expect(oppValueAt({ x: 25, y: 30 })).toBeCloseTo(valueAt({ x: 80, y: 38 }), 10);
  });
});

describe("grading", () => {
  it("gives the best option 100 and worse options less", () => {
    const s = buildScenario(spec([50, 60]));
    const d = evaluateAll(s, s.arrival);
    expect(gradeChoice(d, d.best)).toEqual({ grade: 100, correct: true, gap: 0 });
    const worst = [...d.candidates].sort((a, b) => a.ev - b.ev)[0]!;
    const g = gradeChoice(d, worst);
    expect(g.correct).toBe(false);
    expect(g.grade).toBeLessThan(100);
  });

  it("counts a near-tie as correct", () => {
    const s = buildScenario(spec([50, 60]));
    const d = evaluateAll(s, s.arrival);
    const almost = { ...d.best, ev: d.best.ev - DEFAULT_PARAMS.tieAbs / 2 };
    expect(gradeChoice(d, almost).correct).toBe(true);
  });
});
