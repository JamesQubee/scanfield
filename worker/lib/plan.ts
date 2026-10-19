import type { PlanResponse, SubscriptionInfo } from "../../src/shared/api-types";
import type { Env } from "../env";
import { parseLsTimestamp, toApiTimestamp } from "./time";

export interface SubscriptionRow {
  ls_subscription_id: string;
  status: string;
  variant_id: string | null;
  renews_at: string | null;
  ends_at: string | null;
  test_mode: number;
  ls_updated_at: string;
}

// past_due keeps access while Lemon Squeezy retries the card (about two weeks).
// paused, unpaid and expired do not; cancelled keeps access until ends_at (the grace period).
const ACCESS_STATUSES = new Set(["on_trial", "active", "past_due"]);

export function grantsAccess(row: Pick<SubscriptionRow, "status" | "ends_at">, now: number): boolean {
  if (ACCESS_STATUSES.has(row.status)) return true;
  if (row.status !== "cancelled") return false;
  const endsAt = parseLsTimestamp(row.ends_at);
  return endsAt !== null && endsAt > now;
}

export async function loadSubscriptions(env: Env, playerId: string): Promise<SubscriptionRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT ls_subscription_id, status, variant_id, renews_at, ends_at, test_mode, ls_updated_at
     FROM subscriptions WHERE player_id = ? ORDER BY ls_updated_at DESC`,
  )
    .bind(playerId)
    .all<SubscriptionRow>();
  return results;
}

function toInfo(row: SubscriptionRow): SubscriptionInfo {
  return {
    status: row.status,
    renewsAt: toApiTimestamp(row.renews_at),
    endsAt: toApiTimestamp(row.ends_at),
    testMode: row.test_mode === 1,
  };
}

export async function loadPlan(env: Env, playerId: string, now = Date.now()): Promise<PlanResponse> {
  const rows = await loadSubscriptions(env, playerId);
  const granting = rows.find((row) => grantsAccess(row, now));
  const shown = granting ?? rows[0];
  return { plan: granting ? "pro" : "free", subscription: shown ? toInfo(shown) : null };
}
