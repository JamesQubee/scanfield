import type { CheckoutResponse } from "../../src/shared/api-types";
import type { RouteContext } from "../env";
import type { Player } from "../lib/auth";
import { HttpError, json } from "../lib/http";

// Lemon Squeezy reads checkout[custom][...] from the link and returns it as meta.custom_data
// on the order and subscription webhooks. Brackets stay literal, as in their docs.
export function liveCheckoutUrl(storeUrl: string, playerId: string): string {
  const url = new URL(storeUrl);
  const param = `checkout[custom][player_id]=${encodeURIComponent(playerId)}`;
  url.search = url.search ? `${url.search}&${param}` : param;
  return url.toString();
}

export async function createCheckout(c: RouteContext, player: Player): Promise<Response> {
  if (c.env.DEMO_MODE === "1") {
    const sessionId = crypto.randomUUID();
    await c.env.DB.prepare("INSERT INTO checkout_sessions (id, player_id, created_at) VALUES (?, ?, ?)")
      .bind(sessionId, player.id, Date.now())
      .run();
    return json({ mode: "demo", sessionId } satisfies CheckoutResponse, 201);
  }

  const storeUrl = c.env.LS_STORE_URL?.trim();
  if (!storeUrl) throw new HttpError(503, "checkout_unavailable");
  let url: string;
  try {
    url = liveCheckoutUrl(storeUrl, player.id);
  } catch {
    console.error("LS_STORE_URL is not a valid URL");
    throw new HttpError(503, "checkout_unavailable");
  }
  return json({ mode: "live", url } satisfies CheckoutResponse);
}
