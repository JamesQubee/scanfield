import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { ListRunsResponse, SaveRunResponse } from "../../src/shared/api-types";
import { call, jsonInit, makeRun, moment, newPlayer } from "./helpers";

async function countRows(runId: string) {
  const runs = await env.DB.prepare("SELECT count(*) AS n FROM runs WHERE id = ?").bind(runId).first<{ n: number }>();
  const moments = await env.DB.prepare("SELECT count(*) AS n FROM moments WHERE run_id = ?").bind(runId).first<{ n: number }>();
  return { runs: runs?.n, moments: moments?.n };
}

describe("POST /api/runs", () => {
  it("saves a run with a score computed on the server", async () => {
    const player = await newPlayer();
    const run = {
      ...makeRun({
        moments: [
          moment(0, { grade: 100, correct: true, reactionMs: 800, scans: 3 }),
          moment(1, { grade: 41, correct: false, reactionMs: null, scans: 0 }),
          moment(2, { grade: 60, correct: true, reactionMs: 1201, scans: 2, choiceKind: "timeout", choiceId: null }),
        ],
      }),
      score: 999,
    };

    const res = await call("/api/runs", jsonInit("POST", run, player.token));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, runId: run.id, duplicate: false, score: 67 } satisfies SaveRunResponse);

    const row = await env.DB.prepare("SELECT * FROM runs WHERE id = ?").bind(run.id).first<Record<string, unknown>>();
    expect(row).toMatchObject({
      player_id: player.id,
      score: 67,
      moments_count: 3,
      correct_count: 2,
      avg_reaction_ms: 1001,
      scans_total: 5,
    });
    const moments = await env.DB.prepare("SELECT idx, choice_kind, choice_id, correct, reaction_ms, input_to_frame_ms FROM moments WHERE run_id = ? ORDER BY idx")
      .bind(run.id)
      .all();
    expect(moments.results).toEqual([
      { idx: 0, choice_kind: "pass", choice_id: "p7", correct: 1, reaction_ms: 800, input_to_frame_ms: 12.5 },
      { idx: 1, choice_kind: "pass", choice_id: "p7", correct: 0, reaction_ms: null, input_to_frame_ms: 12.5 },
      { idx: 2, choice_kind: "timeout", choice_id: null, correct: 1, reaction_ms: 1201, input_to_frame_ms: 12.5 },
    ]);
  });

  it("treats a resend of the same id as a duplicate and adds no rows", async () => {
    const player = await newPlayer();
    const run = makeRun();
    const first = await call("/api/runs", jsonInit("POST", run, player.token));
    expect(first.status).toBe(201);

    const resend = { ...run, moments: [...run.moments, moment(3, { grade: 0 })] };
    const second = await call("/api/runs", jsonInit("POST", resend, player.token));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true, runId: run.id, duplicate: true, score: 80 });
    expect(await countRows(run.id)).toEqual({ runs: 1, moments: 3 });
  });

  it("answers 409 when another player reuses a run id, and touches nothing", async () => {
    const owner = await newPlayer("Owner");
    const other = await newPlayer("Other");
    const run = makeRun({ moments: [moment(0)] });
    await call("/api/runs", jsonInit("POST", run, owner.token));

    const hijack = makeRun({ id: run.id, moments: [moment(0, { grade: 0 }), moment(1, { grade: 0 })] });
    const res = await call("/api/runs", jsonInit("POST", hijack, other.token));
    expect(res.status).toBe(409);
    expect(await countRows(run.id)).toEqual({ runs: 1, moments: 1 });
    const row = await env.DB.prepare("SELECT player_id, score FROM runs WHERE id = ?").bind(run.id).first();
    expect(row).toEqual({ player_id: owner.id, score: 80 });
  });

  const tooMany = Array.from({ length: 21 }, (_, i) => moment(i));
  it.each([
    ["a non-UUID id", { id: "run-1" }],
    ["no moments", { moments: [] }],
    ["21 moments", { moments: tooMany }],
    ["duplicate idx", { moments: [moment(0), moment(0)] }],
    ["idx out of range", { moments: [moment(0), moment(2)] }],
    ["grade above 100", { moments: [moment(0, { grade: 101 })] }],
    ["fractional grade", { moments: [moment(0, { grade: 50.5 })] }],
    ["reaction over 60s", { moments: [moment(0, { reactionMs: 60_001 })] }],
    ["too many scans", { moments: [moment(0, { scans: 51 })] }],
    ["unknown choice kind", { moments: [moment(0, { choiceKind: "dribble" as never })] }],
    ["correct as a string", { moments: [moment(0, { correct: "yes" as never })] }],
    ["unsafe drill id", { drillId: "<script>" }],
    ["finish before start", { startedAt: Date.now() - 1_000, finishedAt: Date.now() - 2_000 }],
    ["finish in the future", { finishedAt: Date.now() + 3_600_000 }],
    ["timestamps in seconds", { startedAt: 1_700_000_000, finishedAt: 1_700_000_060 }],
  ])("rejects %s with 400", async (_label, overrides) => {
    const player = await newPlayer();
    const run = { ...makeRun(), ...overrides };
    const res = await call("/api/runs", jsonInit("POST", run, player.token));
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toMatch(/^invalid run: /);
  });

  it("rejects a body over 64 KB with 413", async () => {
    const player = await newPlayer();
    const run = { ...makeRun(), padding: "x".repeat(65 * 1024) };
    const res = await call("/api/runs", jsonInit("POST", run, player.token));
    expect(res.status).toBe(413);
  });

  it("requires auth and a JSON body", async () => {
    expect((await call("/api/runs", jsonInit("POST", makeRun()))).status).toBe(401);
    const player = await newPlayer();
    const res = await call("/api/runs", {
      method: "POST",
      headers: { authorization: `Bearer ${player.token}`, "content-type": "text/plain" },
      body: JSON.stringify(makeRun()),
    });
    expect(res.status).toBe(415);
  });
});

describe("GET /api/runs", () => {
  it("lists the player's runs newest first with per-skill totals", async () => {
    const player = await newPlayer();
    const stranger = await newPlayer("Stranger");
    const base = Date.now() - 600_000;
    const runs = [0, 1, 2].map((i) =>
      makeRun({
        startedAt: base + i * 100_000,
        finishedAt: base + i * 100_000 + 60_000,
        moments: [
          moment(0, { skill: "scanning", grade: 60 + i * 10, correct: i > 0 }),
          moment(1, { skill: "body-shape", grade: 91, correct: true }),
        ],
      }),
    );
    // Saved out of order on purpose: the list follows finishedAt, not arrival.
    for (const run of [runs[1], runs[0], runs[2]]) {
      await call("/api/runs", jsonInit("POST", run, player.token));
    }
    await call("/api/runs", jsonInit("POST", makeRun(), stranger.token));

    const res = await call("/api/runs", jsonInit("GET", undefined, player.token));
    expect(res.status).toBe(200);
    const body = await res.json<ListRunsResponse>();
    expect(body.runs.map((r) => r.id)).toEqual([runs[2]!.id, runs[1]!.id, runs[0]!.id]);
    expect(body.runs[0]).toEqual({
      id: runs[2]!.id,
      drillId: "drill-1",
      score: 86,
      momentsCount: 2,
      correctCount: 2,
      avgReactionMs: 900,
      scansTotal: 4,
      finishedAt: runs[2]!.finishedAt,
    });
    expect(body.skills).toEqual([
      { skill: "body-shape", moments: 3, correct: 3, avgGrade: 91 },
      { skill: "scanning", moments: 3, correct: 2, avgGrade: 70 },
    ]);
  });

  it("caps the list at 20 runs", async () => {
    const player = await newPlayer();
    for (let i = 0; i < 22; i++) {
      await call("/api/runs", jsonInit("POST", makeRun({ moments: [moment(0)] }), player.token));
    }
    const body = await (await call("/api/runs", jsonInit("GET", undefined, player.token))).json<ListRunsResponse>();
    expect(body.runs).toHaveLength(20);
    expect(body.skills).toEqual([{ skill: "scanning", moments: 22, correct: 22, avgGrade: 80 }]);
  });
});
