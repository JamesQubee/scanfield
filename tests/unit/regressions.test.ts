// Regression tests for defects a review found after the first test suite was green.
// Each test failed on the code it was written against.
import { afterEach, describe, expect, it, vi } from "vitest";
import { dist } from "../../src/core/math";
import { DEFAULT_PARAMS } from "../../src/eval/model";
import { recordResult, type DrillRun } from "../../src/game/drill";
import { ballAt, buildScenario, validateSpec, type ScenarioSpec } from "../../src/sim/scenario";
import { loadSpecs } from "./load-scenarios";
import { play, tapMate, tapPoint } from "./support/harness";
import { installLocalStorage } from "./support/memstorage";

const spec = (id: string): ScenarioSpec => structuredClone(loadSpecs().find((s) => s.id === id)!);

describe("scoring", () => {
  it("bg-02: a perfect read (scan, clean touch, pass to 11) succeeds and scores high", () => {
    const s = spec("bg-02-bounce-wide");
    const { m } = play(s, { scans: [[1.7, -1]], tapAfter: 0.2, tap: tapMate("m11") });
    const r = m.result!;
    expect(r.choice!.option.id).toBe("pass:m11");
    expect(r.heavyTouch).toBe(false);
    expect(r.correct).toBe(true);
    expect(r.outcome).toBe("success");
    expect(r.grade).toBeGreaterThanOrEqual(85);
  });

  it("the right choice keeps its marks even when a heavy touch gets it cut out", () => {
    // bg-01: looking away as the ball arrives makes even the set-back too slow.
    const s = spec("bg-01-pressed-from-behind");
    const arrival = buildScenario(s).arrival;
    const { m } = play(s, { scans: [[arrival - 0.12, 1]], tapAfter: 0.1, tap: tapMate("m6") });
    const r = m.result!;
    expect(r.heavyTouch).toBe(true);
    expect(r.choice!.option.id).toBe("setback");
    expect(r.correct).toBe(true);
    expect(r.outcome).toBe("intercepted");
    expect(r.grade).toBeGreaterThan(DEFAULT_PARAMS.failedCap);
  });
});

describe("outcome animation", () => {
  it("ht-03: a ball into space lost in the footrace is taken by a defender who could get there", () => {
    const s = spec("ht-03-away-from-pressure");
    let prev: { x: number; y: number; tau: number } | null = null;
    let maxSpeed = 0;
    const { m } = play(s, {
      tapAfter: 0.1,
      tap: tapPoint(53.5, 20),
      onFrame: (mm) => {
        // Whoever ends up with the ball must have run there at a footballer's speed.
        const holder = mm.ball?.holder;
        if (mm.phase !== "outcome" || !holder || mm.result?.outcome === "success") return;
        const p = mm.truePos(mm.scenario.byId.get(holder)!, mm.tau, { x: 0, y: 0 });
        if (prev && mm.tau - prev.tau > 1e-6) maxSpeed = Math.max(maxSpeed, Math.hypot(p.x - prev.x, p.y - prev.y) / (mm.tau - prev.tau));
        prev = { ...p, tau: mm.tau };
      },
    });
    expect(m.result!.choice!.option.kind).toBe("space");
    expect(maxSpeed).toBeLessThanOrEqual(DEFAULT_PARAMS.defenderSpeed * 1.5);
  });

  it("pf-03: the ball never jumps between frames on a ball into space", () => {
    const s = spec("pf-03-far-side");
    const me = buildScenario(s).receiveAt;
    const a = (135 * Math.PI) / 180;
    let prev: { x: number; y: number } | null = null;
    let prevTau = 0;
    let worst = 0;
    play(s, {
      tapAfter: 0.3,
      tap: tapPoint(me.x + Math.cos(a) * 20, me.y + Math.sin(a) * 20),
      onFrame: (mm) => {
        if (mm.phase !== "outcome") return;
        const b = mm.ballPos(mm.tau, { x: 0, y: 0, h: 0 });
        if (prev && mm.tau > prevTau) worst = Math.max(worst, Math.hypot(b.x - prev.x, b.y - prev.y) - 25 * (mm.tau - prevTau));
        prev = { x: b.x, y: b.y };
        prevTau = mm.tau;
      },
    });
    expect(worst).toBeLessThan(0.3);
  });

  it("the ball does not jump back at the kick", () => {
    for (const sp of loadSpecs()) {
      const s = buildScenario(sp);
      const k = sp.kickAt;
      expect(dist(ballAt(s, k - 1e-6), ballAt(s, k + 1e-6)), sp.id).toBeLessThan(0.05);
    }
  });

  it("a timeout in a scene without defenders still ends", () => {
    const s = spec("ht-03-away-from-pressure");
    s.opponents = [];
    s.scanRequired = false;
    delete s.keyEntity;
    const { m } = play(s, { tapAfter: null }, 6000);
    expect(m.phase).toBe("review");
  });
});

describe("what you knew", () => {
  it("bg-02: players drawn live at the tap are not reported as 'where you thought'", () => {
    const s = spec("bg-02-bounce-wide");
    const arrival = buildScenario(s).arrival;
    let liveAtTap: string[] = [];
    const { m } = play(s, {
      scans: [[arrival - 0.1, 1]],
      tapAfter: 1.4,
      tap: (mm) => {
        liveAtTap = [...mm.vision.memory].filter(([, v]) => v.live).map(([k]) => k);
        return tapPoint(mm.scenario.receiveAt.x + 3, mm.scenario.receiveAt.y)();
      },
    });
    const boardGhosts = m.result!.ghostsAtDecision.map((g) => g.id);
    expect(boardGhosts.filter((id) => liveAtTap.includes(id))).toEqual([]);
  });

  it("the head stays where it was when the ball arrived (no sweeping while you decide)", () => {
    const s = spec("bg-02-bounce-wide");
    const arrival = buildScenario(s).arrival;
    const { m } = play(s, { scans: [[arrival - 0.1, 1]], tapAfter: 1.0, tap: tapPoint(70, 34) });
    expect(m.vision.scanOffset(arrival + 0.3)).toBe(m.vision.scanOffset(arrival));
  });
});

describe("rendering", () => {
  it("a shoulder check turns the drawn head the same way as the field of view", async () => {
    const { PlayersView } = await import("../../src/render/players");
    const { Matrix4, Vector3 } = await import("three");
    const view = new PlayersView(2);
    const pose = { team: "you" as const, number: 6, x: 50, y: 34, heading: 0, speed: 0, phase: 0, headYaw: (150 * Math.PI) / 180, kick: -1, visible: true, ghost: 0, gx: 0, gy: 0, gHeading: 0 };
    view.update([pose], 1, 0);
    const m = new Matrix4();
    view.head.getMatrixAt(0, m);
    const f = new Vector3(1, 0, 0).transformDirection(m);
    // Pitch heading +150 degrees turns towards +y, which is world +z.
    expect(f.z).toBeGreaterThan(0);
  });
});

describe("drill records", () => {
  it("'Try again' replaces the attempt instead of adding a moment", () => {
    const run = { index: 0, results: [] } as unknown as DrillRun;
    const r = (grade: number) => ({ grade }) as never;
    recordResult(run, r(40));
    recordResult(run, r(70));
    expect(run.results.map((x) => x.grade)).toEqual([70]);
    run.index = 1;
    recordResult(run, r(90));
    expect(run.results.map((x) => x.grade)).toEqual([70, 90]);
  });
});

describe("saving runs", () => {
  afterEach(() => vi.unstubAllGlobals());
  const run = (id: string) => ({ id, drillId: "d", contentVersion: "v", startedAt: 1, finishedAt: 2, deviceClass: null, moments: [] });

  it("a run the server refuses is reported as refused, not as saved", async () => {
    const store = installLocalStorage();
    store.set("sf.player", JSON.stringify({ id: "p1", token: "t".repeat(43), nickname: "Calm Fox" }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid run" }), { status: 400 })));
    const { Api } = await import("../../src/platform/api");
    const res = await new Api().saveRun(run("3b241101-e2bb-4255-8caf-4136c566a962") as never);
    expect(res.status).toBe("rejected");
  });

  it("a queued run survives two overlapping flushes", async () => {
    const store = installLocalStorage();
    store.set("sf.player", JSON.stringify({ id: "p1", token: "t".repeat(43), nickname: "Calm Fox" }));
    const r1 = run("11111111-1111-4111-8111-111111111111");
    const r2 = run("22222222-2222-4222-8222-222222222222");
    store.set("sf.outbox", JSON.stringify([r1]));
    let releaseSlow!: () => void;
    const ok = (id: string) => new Response(JSON.stringify({ ok: true, runId: id, duplicate: false, score: 80 }), { status: 201 });
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_p: string, init: RequestInit) => {
        const id = JSON.parse(String(init.body)).id;
        calls++;
        if (calls === 1) return new Promise<Response>((res) => (releaseSlow = () => res(ok(id))));
        if (id === r1.id) return ok(id);
        throw new TypeError("Failed to fetch");
      }),
    );
    const { Api } = await import("../../src/platform/api");
    const api = new Api();
    const a = api.flush();
    await new Promise((r) => setTimeout(r, 0));
    const b = api.saveRun(r2 as never);
    releaseSlow();
    await a;
    expect((await b).status).toBe("pending");
    const outbox = JSON.parse(store.get("sf.outbox") ?? "[]").map((x: { id: string }) => x.id);
    expect(outbox).toContain(r2.id);
    expect(outbox).not.toContain(r1.id);
  });
});

describe("scenario validation", () => {
  it("keyEntity must name a player", () => {
    const s = spec("pf-03-far-side");
    s.spaces = [{ id: "gap", label: "Gap", at: [60, 30] }];
    s.keyEntity = "space:gap";
    expect(() => validateSpec(s)).toThrow(/keyEntity/);
  });
});
