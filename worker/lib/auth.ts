import type { Env, Handler, RouteContext } from "../env";
import { sha256Hex } from "./crypto";
import { HttpError } from "./http";

export interface Player {
  id: string;
  nickname: string;
}

export async function hashToken(token: string, env: Env): Promise<string> {
  if (!env.TOKEN_PEPPER) throw new HttpError(503, "server_misconfigured: TOKEN_PEPPER is not set");
  return sha256Hex(token + env.TOKEN_PEPPER);
}

// Tokens are 32 random bytes in base64url, which is always 43 characters.
const BEARER = /^Bearer\s+([A-Za-z0-9_-]{43})\s*$/i;

export async function requirePlayer(request: Request, env: Env): Promise<Player> {
  const match = BEARER.exec(request.headers.get("authorization") ?? "");
  if (!match?.[1]) throw new HttpError(401, "unauthorized");
  const player = await env.DB.prepare("SELECT id, nickname FROM players WHERE token_hash = ?")
    .bind(await hashToken(match[1], env))
    .first<Player>();
  if (!player) throw new HttpError(401, "unauthorized");
  return player;
}

export function authed(handler: (c: RouteContext, player: Player) => Promise<Response>): Handler {
  return async (c) => handler(c, await requirePlayer(c.request, c.env));
}
