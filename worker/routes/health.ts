import type { RouteContext } from "../env";
import { json } from "../lib/http";

export async function health(c: RouteContext): Promise<Response> {
  const row = await c.env.DB.prepare("SELECT count(*) AS n FROM players").first<{ n: number }>();
  return json({ ok: true, players: row?.n ?? 0 });
}
