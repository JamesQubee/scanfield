import type { Env } from "../env";
import { sha256Hex, verifyHmacSha256Hex } from "../lib/crypto";
import { errorJson, HttpError, isRecord, json, readBody } from "../lib/http";
import { canonicalLsTimestamp } from "../lib/time";

const BODY_LIMIT = 256 * 1024;

type EventResult = "applied" | "stale" | "ignored" | "invalid";

// Only these fields ever leave the parser. user_email, user_name, card details, urls and every
// other attribute in the payload are dropped here and never stored or logged.
interface SubscriptionUpdate {
  id: string;
  playerId: string | null;
  status: string;
  variantId: string | null;
  renewsAt: string | null;
  endsAt: string | null;
  testMode: boolean;
  lsUpdatedAt: string;
}

interface ParsedEvent {
  eventName: string;
  objectId: string | null;
  subscription: SubscriptionUpdate | null;
  result: EventResult;
}

function shortString(value: unknown, max = 64): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

function parseSubscription(meta: Record<string, unknown>, data: Record<string, unknown>): SubscriptionUpdate | null {
  const id = shortString(data.id);
  const attributes = isRecord(data.attributes) ? data.attributes : null;
  const status = shortString(attributes?.status, 32);
  const lsUpdatedAt = canonicalLsTimestamp(attributes?.updated_at);
  if (!id || !attributes || !status || !lsUpdatedAt) return null;

  const customData = isRecord(meta.custom_data) ? meta.custom_data : {};
  const testMode = attributes.test_mode ?? meta.test_mode;
  return {
    id,
    playerId: shortString(customData.player_id),
    status,
    variantId: shortString(attributes.variant_id),
    renewsAt: canonicalLsTimestamp(attributes.renews_at),
    endsAt: canonicalLsTimestamp(attributes.ends_at),
    testMode: testMode === true,
    lsUpdatedAt,
  };
}

function parseEvent(raw: Uint8Array, headerEventName: string | null): ParsedEvent {
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  if (!isRecord(payload)) throw new HttpError(400, "invalid_payload");

  const meta = isRecord(payload.meta) ? payload.meta : {};
  const data = isRecord(payload.data) ? payload.data : {};
  // meta.event_name is covered by the signature; the X-Event-Name header is not.
  const eventName = shortString(meta.event_name) ?? shortString(headerEventName) ?? "unknown";
  const objectId = shortString(data.id);

  if (!eventName.startsWith("subscription_") || data.type !== "subscriptions") {
    return { eventName, objectId, subscription: null, result: "ignored" };
  }
  const subscription = parseSubscription(meta, data);
  return { eventName, objectId, subscription, result: subscription ? "applied" : "invalid" };
}

// The player link only changes when custom_data names a player that exists; events without it
// keep the current link. The final WHERE drops events older than what is stored.
const UPSERT_SUBSCRIPTION = `
INSERT INTO subscriptions
  (ls_subscription_id, player_id, status, variant_id, renews_at, ends_at, test_mode, ls_updated_at, updated_at)
SELECT ?1, (SELECT id FROM players WHERE id = ?2), ?3, ?4, ?5, ?6, ?7, ?8, ?9
WHERE NOT EXISTS (SELECT 1 FROM webhook_events WHERE dedupe_key = ?10)
ON CONFLICT(ls_subscription_id) DO UPDATE SET
  player_id = coalesce(excluded.player_id, subscriptions.player_id),
  status = excluded.status,
  variant_id = excluded.variant_id,
  renews_at = excluded.renews_at,
  ends_at = excluded.ends_at,
  test_mode = excluded.test_mode,
  ls_updated_at = excluded.ls_updated_at,
  updated_at = excluded.updated_at
WHERE excluded.ls_updated_at >= subscriptions.ls_updated_at`;

const INSERT_EVENT = `
INSERT INTO webhook_events (dedupe_key, event_name, ls_object_id, result, received_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(dedupe_key) DO NOTHING`;

async function store(env: Env, dedupeKey: string, event: ParsedEvent): Promise<{ duplicate: boolean; result: EventResult }> {
  const now = Date.now();
  const sub = event.subscription;
  const statements: D1PreparedStatement[] = [];
  if (sub) {
    statements.push(
      env.DB.prepare(UPSERT_SUBSCRIPTION).bind(
        sub.id,
        sub.playerId,
        sub.status,
        sub.variantId,
        sub.renewsAt,
        sub.endsAt,
        sub.testMode ? 1 : 0,
        sub.lsUpdatedAt,
        now,
        dedupeKey,
      ),
    );
  }
  statements.push(
    env.DB.prepare(INSERT_EVENT).bind(dedupeKey, event.eventName, event.objectId, event.result, now),
  );

  // One transaction: the subscription change and the dedupe record land together or not at all,
  // so a failed write is retried by Lemon Squeezy instead of being marked as seen.
  const results = await env.DB.batch(statements);
  if (results.at(-1)?.meta.changes !== 1) return { duplicate: true, result: event.result };

  if (sub && results[0]?.meta.changes === 0) {
    await env.DB.prepare("UPDATE webhook_events SET result = 'stale' WHERE dedupe_key = ?").bind(dedupeKey).run();
    return { duplicate: false, result: "stale" };
  }
  return { duplicate: false, result: event.result };
}

export async function handleLemonSqueezyWebhook(request: Request, env: Env): Promise<Response> {
  const raw = await readBody(request, BODY_LIMIT);
  const secret = env.LS_SIGNING_SECRET;
  if (!secret) {
    console.warn("lemonsqueezy webhook rejected: LS_SIGNING_SECRET is not set");
    return errorJson(401, "unauthorized");
  }
  if (!(await verifyHmacSha256Hex(secret, raw, request.headers.get("x-signature")))) {
    return errorJson(401, "invalid_signature");
  }

  const event = parseEvent(raw, request.headers.get("x-event-name"));
  const dedupeKey = await sha256Hex(raw);
  let outcome: Awaited<ReturnType<typeof store>>;
  try {
    outcome = await store(env, dedupeKey, event);
  } catch (err) {
    console.error("lemonsqueezy webhook db error", err instanceof Error ? err.message : "unknown");
    return errorJson(500, "db_error");
  }

  console.log(
    JSON.stringify({ webhook: event.eventName, object: event.objectId, result: outcome.result, duplicate: outcome.duplicate }),
  );
  return json({ ok: true, duplicate: outcome.duplicate, result: outcome.result });
}
