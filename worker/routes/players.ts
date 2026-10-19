import type { CreatePlayerResponse, MeResponse } from "../../src/shared/api-types";
import type { RouteContext } from "../env";
import { hashToken, type Player } from "../lib/auth";
import { randomToken } from "../lib/crypto";
import { HttpError, isRecord, json, readJson } from "../lib/http";
import { normalizeNickname } from "../lib/nickname";
import { loadPlan } from "../lib/plan";

export async function createPlayer(c: RouteContext): Promise<Response> {
  const body = await readJson(c.request, 1024);
  const nickname = normalizeNickname(isRecord(body) ? body.nickname : undefined);
  if (!nickname) {
    throw new HttpError(400, "nickname must be 2-16 letters, digits, spaces, _ or - and must not look like contact details");
  }

  const id = crypto.randomUUID();
  const token = randomToken();
  await c.env.DB.prepare("INSERT INTO players (id, token_hash, nickname, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, await hashToken(token, c.env), nickname, Date.now())
    .run();
  return json({ id, token, nickname } satisfies CreatePlayerResponse, 201);
}

export async function getMe(c: RouteContext, player: Player): Promise<Response> {
  const { plan, subscription } = await loadPlan(c.env, player.id);
  return json({ id: player.id, nickname: player.nickname, plan, subscription } satisfies MeResponse);
}
