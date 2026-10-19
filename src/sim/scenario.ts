// A scenario is one "moment": the ball is played into you, you scan, you decide.
// Scenarios are plain JSON so a coach's spec can be turned into a playable scene
// without touching engine code. This module validates them and samples motion.

import { PITCH_LENGTH, PITCH_WIDTH, type V2 } from "../core/math";

export type Skill = "half-turn" | "play-forward" | "back-to-goal";
export const SKILLS: Record<Skill, string> = {
  "half-turn": "Half-turn",
  "play-forward": "Play forward",
  "back-to-goal": "Back to goal",
};

/** A keyframe: [time s, x m, y m]. */
export type Key = [number, number, number];

export interface EntitySpec {
  id: string;
  number: number;
  path: Key[];
}

export interface SpaceSpec {
  id: string;
  label: string;
  at: [number, number];
}

export interface ScenarioSpec {
  id: string;
  version: number;
  title: string;
  skill: Skill;
  /** One line shown before the moment starts. */
  brief: string;
  coach: {
    /** Why the best option is best, shown on the coach board. */
    why: string;
    /** The habit to take away. */
    tip: string;
  };
  /** Option id the author expects to be best: "carry", "setback", "pass:<id>" or "space:<id>". */
  intendedBest: string;
  /** True when the answer depends on a player you can only see by checking your shoulder. */
  scanRequired: boolean;
  /** The player the answer hinges on (for scanRequired tests and the board). */
  keyEntity?: string;
  /** Untimed moments wait for the tap; timed ones give a decision window. */
  timed: boolean;
  /** Scenario time when the passer plays the ball. */
  kickAt: number;
  /** Speed of the pass into you, m/s. */
  passSpeed: number;
  you: EntitySpec;
  passer: string;
  teammates: EntitySpec[];
  opponents: EntitySpec[];
  spaces?: SpaceSpec[];
}

export type Team = "you" | "mate" | "opp";

export interface Entity {
  id: string;
  number: number;
  team: Team;
  keys: Key[];
  /** Hermite tangents per key, m/s. */
  tangents: V2[];
}

export interface Scenario {
  spec: ScenarioSpec;
  you: Entity;
  passer: Entity;
  mates: Entity[]; // teammates other than you, passer included
  opps: Entity[];
  all: Entity[]; // you first, then mates, then opps
  byId: Map<string, Entity>;
  /** Scenario time when the ball reaches you. */
  arrival: number;
  /** Where the passer kicks from and where you receive. */
  kickFrom: V2;
  receiveAt: V2;
}

export class ScenarioError extends Error {}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

function fail(id: string, msg: string): never {
  throw new ScenarioError(`${id}: ${msg}`);
}

function checkEntity(sid: string, e: EntitySpec, ids: Set<string>): void {
  if (!e || typeof e.id !== "string" || !ID_RE.test(e.id)) fail(sid, `bad entity id ${JSON.stringify(e?.id)}`);
  if (ids.has(e.id)) fail(sid, `duplicate entity id ${e.id}`);
  ids.add(e.id);
  if (!Number.isInteger(e.number) || e.number < 1 || e.number > 99) fail(sid, `${e.id}: shirt number must be 1..99`);
  if (!Array.isArray(e.path) || e.path.length === 0) fail(sid, `${e.id}: path needs at least one key`);
  let prevT = -Infinity;
  for (const k of e.path) {
    if (!Array.isArray(k) || k.length !== 3 || !k.every((n) => typeof n === "number" && Number.isFinite(n))) fail(sid, `${e.id}: key must be [t, x, y]`);
    const [t, x, y] = k;
    if (t <= prevT) fail(sid, `${e.id}: key times must increase`);
    if (x < 0 || x > PITCH_LENGTH || y < 0 || y > PITCH_WIDTH) fail(sid, `${e.id}: key (${x}, ${y}) is off the pitch`);
    prevT = t;
  }
  if (e.path[0]![0] !== 0) fail(sid, `${e.id}: first key must be at t=0`);
}

/** Validates a spec; throws ScenarioError with a readable message on the first problem. */
export function validateSpec(spec: ScenarioSpec): void {
  const sid = typeof spec?.id === "string" ? spec.id : "(no id)";
  if (!ID_RE.test(sid)) fail(sid, "id must be lowercase letters, digits and dashes");
  if (!Number.isInteger(spec.version) || spec.version < 1) fail(sid, "version must be a positive integer");
  if (!(spec.skill in SKILLS)) fail(sid, `unknown skill ${spec.skill}`);
  for (const f of ["title", "brief"] as const) if (typeof spec[f] !== "string" || !spec[f].trim()) fail(sid, `${f} is required`);
  if (!spec.coach || typeof spec.coach.why !== "string" || typeof spec.coach.tip !== "string") fail(sid, "coach.why and coach.tip are required");
  if (typeof spec.timed !== "boolean" || typeof spec.scanRequired !== "boolean") fail(sid, "timed and scanRequired must be booleans");
  if (!(spec.kickAt >= 0.5 && spec.kickAt <= 4)) fail(sid, "kickAt must be 0.5..4 s");
  if (!(spec.passSpeed >= 6 && spec.passSpeed <= 25)) fail(sid, "passSpeed must be 6..25 m/s");
  const ids = new Set<string>();
  checkEntity(sid, spec.you, ids);
  if (!Array.isArray(spec.teammates) || !Array.isArray(spec.opponents)) fail(sid, "teammates and opponents must be arrays");
  for (const e of spec.teammates) checkEntity(sid, e, ids);
  for (const e of spec.opponents) checkEntity(sid, e, ids);
  if (spec.teammates.length + spec.opponents.length > 20) fail(sid, "at most 20 other players");
  if (!spec.teammates.some((m) => m.id === spec.passer)) fail(sid, `passer ${spec.passer} is not a teammate`);
  for (const s of spec.spaces ?? []) {
    if (!ID_RE.test(s.id) || ids.has(`space:${s.id}`)) fail(sid, `bad or duplicate space id ${s.id}`);
    ids.add(`space:${s.id}`);
    const [x, y] = s.at;
    if (!(x >= 0 && x <= PITCH_LENGTH && y >= 0 && y <= PITCH_WIDTH)) fail(sid, `space ${s.id} is off the pitch`);
  }
  const best = spec.intendedBest;
  const okBest =
    best === "carry" ||
    best === "setback" ||
    (best.startsWith("pass:") && spec.teammates.some((m) => `pass:${m.id}` === best && m.id !== spec.passer)) ||
    (best.startsWith("space:") && (spec.spaces ?? []).some((s) => `space:${s.id}` === best));
  if (!okBest) fail(sid, `intendedBest ${best} does not name an option in this scenario`);
  const players = new Set([...spec.teammates, ...spec.opponents].map((e) => e.id));
  if (spec.keyEntity !== undefined && !players.has(spec.keyEntity)) fail(sid, `keyEntity ${spec.keyEntity} must be a teammate or an opponent`);
  if (spec.scanRequired && spec.keyEntity === undefined) fail(sid, "scanRequired needs keyEntity");
}

function buildEntity(e: EntitySpec, team: Team): Entity {
  const keys = e.path.map((k) => [k[0], k[1], k[2]] as Key);
  const n = keys.length;
  const tangents: V2[] = keys.map((k, i) => {
    if (n === 1) return { x: 0, y: 0 };
    const a = keys[Math.max(0, i - 1)]!;
    const b = keys[Math.min(n - 1, i + 1)]!;
    // The last key is where a run ends: the player arrives and stops.
    if (i === n - 1) return { x: 0, y: 0 };
    const dt = b[0] - a[0];
    return { x: (b[1] - a[1]) / dt, y: (b[2] - a[2]) / dt };
  });
  return { id: e.id, number: e.number, team, keys, tangents };
}

/** Position at scenario time t (cubic Hermite through the keys; holds after the last key). */
export function posAt(e: Entity, t: number, out: V2 = { x: 0, y: 0 }): V2 {
  const k = e.keys;
  const n = k.length;
  if (n === 1 || t <= k[0]![0]) {
    out.x = k[0]![1];
    out.y = k[0]![2];
    return out;
  }
  if (t >= k[n - 1]![0]) {
    out.x = k[n - 1]![1];
    out.y = k[n - 1]![2];
    return out;
  }
  let i = 0;
  while (t > k[i + 1]![0]) i++;
  const a = k[i]!;
  const b = k[i + 1]!;
  const ta = e.tangents[i]!;
  const tb = e.tangents[i + 1]!;
  const h = b[0] - a[0];
  const s = (t - a[0]) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  out.x = h00 * a[1] + h10 * h * ta.x + h01 * b[1] + h11 * h * tb.x;
  out.y = h00 * a[2] + h10 * h * ta.y + h01 * b[2] + h11 * h * tb.y;
  return out;
}

const tmpA: V2 = { x: 0, y: 0 };
const tmpB: V2 = { x: 0, y: 0 };
/** Velocity at scenario time t, m/s (central difference of posAt). */
export function velAt(e: Entity, t: number, out: V2 = { x: 0, y: 0 }): V2 {
  const d = 1 / 120;
  posAt(e, t + d, tmpA);
  posAt(e, t - d, tmpB);
  out.x = (tmpA.x - tmpB.x) / (2 * d);
  out.y = (tmpA.y - tmpB.y) / (2 * d);
  return out;
}

/** How far in front of the passer the ball sits before the kick, m. */
const BALL_LEAD = 0.6;

export function buildScenario(spec: ScenarioSpec): Scenario {
  validateSpec(spec);
  const you = buildEntity(spec.you, "you");
  const mates = spec.teammates.map((e) => buildEntity(e, "mate"));
  const opps = spec.opponents.map((e) => buildEntity(e, "opp"));
  const all = [you, ...mates, ...opps];
  const byId = new Map(all.map((e) => [e.id, e]));
  const passer = byId.get(spec.passer)!;
  const feet = posAt(passer, spec.kickAt);
  // The ball meets you where you will be when it arrives: solve by fixed-point iteration.
  // It is struck from just in front of the passer (where it sits before the kick).
  let arrival = spec.kickAt + 1;
  const receiveAt: V2 = { x: 0, y: 0 };
  const kickFrom: V2 = { x: feet.x, y: feet.y };
  for (let i = 0; i < 6; i++) {
    posAt(you, arrival, receiveAt);
    const dx = receiveAt.x - feet.x;
    const dy = receiveAt.y - feet.y;
    const d = Math.hypot(dx, dy) || 1;
    kickFrom.x = feet.x + (dx / d) * BALL_LEAD;
    kickFrom.y = feet.y + (dy / d) * BALL_LEAD;
    arrival = spec.kickAt + Math.hypot(receiveAt.x - kickFrom.x, receiveAt.y - kickFrom.y) / spec.passSpeed;
  }
  posAt(you, arrival, receiveAt);
  return { spec, you, passer, mates, opps, all, byId, arrival, kickFrom, receiveAt };
}

/** Ball position at scenario time t: at the passer's feet, rolling to you, then at your feet. */
export function ballAt(s: Scenario, t: number, out: V2 = { x: 0, y: 0 }): V2 {
  const kick = s.spec.kickAt;
  if (t <= kick) {
    posAt(s.passer, t, out);
    // Just in front of the passer, towards you.
    const dx = s.receiveAt.x - out.x;
    const dy = s.receiveAt.y - out.y;
    const d = Math.hypot(dx, dy) || 1;
    out.x += (dx / d) * BALL_LEAD;
    out.y += (dy / d) * BALL_LEAD;
    return out;
  }
  if (t >= s.arrival) return posAt(s.you, t, out);
  const k = (t - kick) / (s.arrival - kick);
  out.x = s.kickFrom.x + (s.receiveAt.x - s.kickFrom.x) * k;
  out.y = s.kickFrom.y + (s.receiveAt.y - s.kickFrom.y) * k;
  return out;
}
