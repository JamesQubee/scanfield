import type { ChoiceKind } from "../../src/shared/api-types";
import { HttpError, isRecord, UUID } from "./http";

export interface ValidMoment {
  idx: number;
  sceneId: string;
  skill: string;
  choiceKind: ChoiceKind;
  choiceId: string | null;
  bestId: string;
  grade: number;
  correct: boolean;
  reactionMs: number | null;
  scans: number;
  lastScanBeforeArrivalMs: number | null;
  inputToFrameMs: number | null;
}

export interface ValidRun {
  id: string;
  drillId: string;
  contentVersion: string;
  startedAt: number;
  finishedAt: number;
  deviceClass: string | null;
  moments: ValidMoment[];
}

export interface RunSummary {
  score: number;
  correctCount: number;
  avgReactionMs: number | null;
  scansTotal: number;
}

const SAFE_STRING = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const CHOICE_KINDS: readonly ChoiceKind[] = ["pass", "setback", "carry", "space", "timeout"];
const MAX_MOMENTS = 20;
const EARLIEST_RUN = Date.UTC(2024, 0, 1);
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_RUN_DURATION_MS = 3 * 60 * 60_000;

function invalid(path: string, rule: string): never {
  throw new HttpError(400, `invalid run: ${path} ${rule}`);
}

function safeString(value: unknown, path: string): string {
  if (typeof value !== "string" || !SAFE_STRING.test(value)) {
    invalid(path, "must be 1-64 characters of letters, digits, . _ : -");
  }
  return value;
}

function integer(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    invalid(path, `must be an integer ${min}..${max}`);
  }
  return value;
}

function finite(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    invalid(path, `must be a number ${min}..${max}`);
  }
  return value;
}

function nullable<T>(value: unknown, read: (v: unknown) => T): T | null {
  return value === null ? null : read(value);
}

function parseMoment(raw: unknown, path: string, count: number): ValidMoment {
  if (!isRecord(raw)) invalid(path, "must be an object");
  const choiceKind = raw.choiceKind as ChoiceKind;
  if (!CHOICE_KINDS.includes(choiceKind)) invalid(`${path}.choiceKind`, `must be one of ${CHOICE_KINDS.join(", ")}`);
  if (typeof raw.correct !== "boolean") invalid(`${path}.correct`, "must be a boolean");

  return {
    idx: integer(raw.idx, `${path}.idx`, 0, count - 1),
    sceneId: safeString(raw.sceneId, `${path}.sceneId`),
    skill: safeString(raw.skill, `${path}.skill`),
    choiceKind,
    choiceId: nullable(raw.choiceId, (v) => safeString(v, `${path}.choiceId`)),
    bestId: safeString(raw.bestId, `${path}.bestId`),
    grade: integer(raw.grade, `${path}.grade`, 0, 100),
    correct: raw.correct,
    reactionMs: nullable(raw.reactionMs, (v) => Math.round(finite(v, `${path}.reactionMs`, 0, 60_000))),
    scans: integer(raw.scans, `${path}.scans`, 0, 50),
    lastScanBeforeArrivalMs: nullable(raw.lastScanBeforeArrivalMs, (v) =>
      Math.round(finite(v, `${path}.lastScanBeforeArrivalMs`, 0, 60_000)),
    ),
    inputToFrameMs: nullable(raw.inputToFrameMs, (v) => finite(v, `${path}.inputToFrameMs`, 0, 10_000)),
  };
}

// Unknown fields (a client-side score, say) are ignored rather than trusted.
export function parseRunPayload(raw: unknown, now = Date.now()): ValidRun {
  if (!isRecord(raw)) invalid("body", "must be an object");
  if (typeof raw.id !== "string" || !UUID.test(raw.id)) invalid("id", "must be a UUID");

  const startedAt = integer(raw.startedAt, "startedAt", EARLIEST_RUN, now + MAX_CLOCK_SKEW_MS);
  const finishedAt = integer(raw.finishedAt, "finishedAt", startedAt, now + MAX_CLOCK_SKEW_MS);
  if (finishedAt - startedAt > MAX_RUN_DURATION_MS) invalid("finishedAt", "is more than 3 hours after startedAt");

  if (!Array.isArray(raw.moments) || raw.moments.length < 1 || raw.moments.length > MAX_MOMENTS) {
    invalid("moments", `must be an array of 1..${MAX_MOMENTS} moments`);
  }
  const count = raw.moments.length;
  const moments = raw.moments.map((m, i) => parseMoment(m, `moments[${i}]`, count));
  if (new Set(moments.map((m) => m.idx)).size !== count) invalid("moments", "idx values must be unique 0..n-1");

  return {
    id: raw.id.toLowerCase(),
    drillId: safeString(raw.drillId, "drillId"),
    contentVersion: safeString(raw.contentVersion, "contentVersion"),
    startedAt,
    finishedAt,
    deviceClass: nullable(raw.deviceClass ?? null, (v) => safeString(v, "deviceClass")),
    moments: moments.sort((a, b) => a.idx - b.idx),
  };
}

export function summarizeRun(moments: ValidMoment[]): RunSummary {
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const reactions = moments.flatMap((m) => (m.reactionMs === null ? [] : [m.reactionMs]));
  return {
    score: Math.round(sum(moments.map((m) => m.grade)) / moments.length),
    correctCount: moments.filter((m) => m.correct).length,
    avgReactionMs: reactions.length ? Math.round(sum(reactions) / reactions.length) : null,
    scansTotal: sum(moments.map((m) => m.scans)),
  };
}
