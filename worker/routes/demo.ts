import type { Env, Handler, RouteContext } from "../env";
import type { Player } from "../lib/auth";
import { HttpError, isRecord, json, readJson, UUID } from "../lib/http";
import { deliverDemoEvent, newDemoSubscriptionId, type DemoSubscriptionEvent } from "../lib/ls-demo";
import { grantsAccess, loadPlan, loadSubscriptions } from "../lib/plan";
import { parseLsTimestamp } from "../lib/time";

const DAY_MS = 24 * 60 * 60_000;

// Checked before auth so a production build answers 404 whoever asks.
export function demoOnly(handler: Handler): Handler {
  return async (c) => {
    if (c.env.DEMO_MODE !== "1") throw new HttpError(404, "not_found");
    return handler(c);
  };
}

function signingSecret(env: Env): string {
  if (!env.LS_SIGNING_SECRET) throw new HttpError(503, "server_misconfigured: LS_SIGNING_SECRET is not set");
  return env.LS_SIGNING_SECRET;
}

async function deliver(env: Env, secret: string, event: DemoSubscriptionEvent): Promise<void> {
  const res = await deliverDemoEvent(env, secret, event);
  if (!res.ok) throw new HttpError(502, `demo webhook rejected (${res.status})`);
}

export async function completeDemoCheckout(c: RouteContext, player: Player): Promise<Response> {
  const body = await readJson(c.request, 1024);
  const sessionId = isRecord(body) && typeof body.sessionId === "string" ? body.sessionId : "";
  if (!UUID.test(sessionId)) throw new HttpError(400, "sessionId must be a UUID");
  const secret = signingSecret(c.env);
  const db = c.env.DB;
  const now = Date.now();

  // Claim the session atomically so two concurrent completes cannot both subscribe.
  const claim = await db.prepare(
    "UPDATE checkout_sessions SET completed_at = ? WHERE id = ? AND player_id = ? AND completed_at IS NULL",
  )
    .bind(now, sessionId, player.id)
    .run();
  if (claim.meta.changes !== 1) {
    const exists = await db.prepare("SELECT 1 FROM checkout_sessions WHERE id = ? AND player_id = ?")
      .bind(sessionId, player.id)
      .first();
    throw exists
      ? new HttpError(409, "checkout session already completed")
      : new HttpError(404, "checkout session not found");
  }

  try {
    await deliver(c.env, secret, {
      eventName: "subscription_created",
      subscriptionId: newDemoSubscriptionId(),
      playerId: player.id,
      status: "active",
      createdAt: now,
      updatedAt: now,
      renewsAt: now + 30 * DAY_MS,
      endsAt: null,
    });
  } catch (err) {
    await db.prepare("UPDATE checkout_sessions SET completed_at = NULL WHERE id = ?").bind(sessionId).run();
    throw err;
  }
  return json(await loadPlan(c.env, player.id));
}

// A real cancellation keeps Pro until ends_at, then Lemon Squeezy sends subscription_expired.
// The demo sends both events back to back, so the grace period is skipped and the plan drops now.
export async function cancelDemoSubscription(c: RouteContext, player: Player): Promise<Response> {
  const secret = signingSecret(c.env);
  const now = Date.now();
  const sub = (await loadSubscriptions(c.env, player.id)).find((row) => grantsAccess(row, now));
  if (!sub) throw new HttpError(409, "no active subscription");

  const t = Math.max(now, parseLsTimestamp(sub.ls_updated_at) ?? 0);
  const renewsAt = parseLsTimestamp(sub.renews_at) ?? t + 30 * DAY_MS;
  const base = { subscriptionId: sub.ls_subscription_id, playerId: player.id, createdAt: t, renewsAt };

  await deliver(c.env, secret, {
    ...base,
    eventName: "subscription_cancelled",
    status: "cancelled",
    updatedAt: t,
    endsAt: renewsAt,
  });
  await deliver(c.env, secret, {
    ...base,
    eventName: "subscription_expired",
    status: "expired",
    updatedAt: t + 1,
    endsAt: t + 1,
  });
  return json(await loadPlan(c.env, player.id));
}
