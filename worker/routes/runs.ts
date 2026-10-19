import type { ListRunsResponse, RunSummary, SaveRunResponse } from "../../src/shared/api-types";
import type { RouteContext } from "../env";
import type { Player } from "../lib/auth";
import { HttpError, json, readJson } from "../lib/http";
import { PRO_DRILL_IDS } from "../../src/shared/plans";
import { loadPlan } from "../lib/plan";
import { parseRunPayload, summarizeRun, type ValidRun } from "../lib/validate-run";

// Checked here too, so a free player cannot record Pro drills by editing a URL.
const PRO_DRILLS = new Set(PRO_DRILL_IDS);

const BODY_LIMIT = 64 * 1024;

const INSERT_RUN = `
INSERT INTO runs (id, player_id, drill_id, content_version, score, moments_count, correct_count,
  avg_reaction_ms, scans_total, device_class, started_at, finished_at, received_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO NOTHING`;

// Runs are never stored without moments, so "this player's run with no moments yet" can only be
// the row the statement before just inserted. A resend, or a reused id, inserts nothing.
const INSERT_MOMENTS = `
INSERT INTO moments (run_id, idx, scene_id, skill, choice_kind, choice_id, best_id, grade, correct,
  reaction_ms, scans, last_scan_before_arrival_ms, input_to_frame_ms)
SELECT ?1, m.value ->> '$.idx', m.value ->> '$.scene_id', m.value ->> '$.skill', m.value ->> '$.choice_kind',
  m.value ->> '$.choice_id', m.value ->> '$.best_id', m.value ->> '$.grade', m.value ->> '$.correct',
  m.value ->> '$.reaction_ms', m.value ->> '$.scans', m.value ->> '$.last_scan_before_arrival_ms',
  m.value ->> '$.input_to_frame_ms'
FROM json_each(?3) AS m
WHERE EXISTS (SELECT 1 FROM runs WHERE id = ?1 AND player_id = ?2)
  AND NOT EXISTS (SELECT 1 FROM moments WHERE run_id = ?1)`;

function momentRows(run: ValidRun): string {
  return JSON.stringify(
    run.moments.map((m) => ({
      idx: m.idx,
      scene_id: m.sceneId,
      skill: m.skill,
      choice_kind: m.choiceKind,
      choice_id: m.choiceId,
      best_id: m.bestId,
      grade: m.grade,
      correct: m.correct ? 1 : 0,
      reaction_ms: m.reactionMs,
      scans: m.scans,
      last_scan_before_arrival_ms: m.lastScanBeforeArrivalMs,
      input_to_frame_ms: m.inputToFrameMs,
    })),
  );
}

export async function saveRun(c: RouteContext, player: Player): Promise<Response> {
  const run = parseRunPayload(await readJson(c.request, BODY_LIMIT));
  if (PRO_DRILLS.has(run.drillId) && (await loadPlan(c.env, player.id)).plan !== "pro") {
    throw new HttpError(403, "pro_required");
  }
  const s = summarizeRun(run.moments);
  const db = c.env.DB;

  const [inserted] = await db.batch([
    db.prepare(INSERT_RUN).bind(
      run.id, player.id, run.drillId, run.contentVersion, s.score, run.moments.length, s.correctCount,
      s.avgReactionMs, s.scansTotal, run.deviceClass, run.startedAt, run.finishedAt, Date.now(),
    ),
    db.prepare(INSERT_MOMENTS).bind(run.id, player.id, momentRows(run)),
  ]);
  if (inserted?.meta.changes === 1) {
    return json({ ok: true, runId: run.id, duplicate: false, score: s.score } satisfies SaveRunResponse, 201);
  }

  const existing = await db.prepare("SELECT player_id, score FROM runs WHERE id = ?")
    .bind(run.id)
    .first<{ player_id: string; score: number }>();
  if (existing?.player_id !== player.id) throw new HttpError(409, "run id already used by another player");
  return json({ ok: true, runId: run.id, duplicate: true, score: existing.score } satisfies SaveRunResponse);
}

interface RunRow {
  id: string;
  drill_id: string;
  score: number;
  moments_count: number;
  correct_count: number;
  avg_reaction_ms: number | null;
  scans_total: number;
  finished_at: number;
}

interface SkillRow {
  skill: string;
  moments: number;
  correct: number;
  avg_grade: number;
}

export async function listRuns(c: RouteContext, player: Player): Promise<Response> {
  const db = c.env.DB;
  const [runs, skills] = await Promise.all([
    db.prepare(
      `SELECT id, drill_id, score, moments_count, correct_count, avg_reaction_ms, scans_total, finished_at
       FROM runs WHERE player_id = ? ORDER BY finished_at DESC, received_at DESC LIMIT 20`,
    )
      .bind(player.id)
      .all<RunRow>(),
    db.prepare(
      `SELECT m.skill AS skill, count(*) AS moments, sum(m.correct) AS correct, avg(m.grade) AS avg_grade
       FROM moments m JOIN runs r ON r.id = m.run_id
       WHERE r.player_id = ? GROUP BY m.skill ORDER BY m.skill`,
    )
      .bind(player.id)
      .all<SkillRow>(),
  ]);

  return json({
    runs: runs.results.map(
      (r): RunSummary => ({
        id: r.id,
        drillId: r.drill_id,
        score: r.score,
        momentsCount: r.moments_count,
        correctCount: r.correct_count,
        avgReactionMs: r.avg_reaction_ms,
        scansTotal: r.scans_total,
        finishedAt: r.finished_at,
      }),
    ),
    skills: skills.results.map((s) => ({
      skill: s.skill,
      moments: s.moments,
      correct: s.correct,
      avgGrade: Math.round(s.avg_grade),
    })),
  } satisfies ListRunsResponse);
}
