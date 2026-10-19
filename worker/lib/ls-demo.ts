import type { Env } from "../env";
import { handleLemonSqueezyWebhook } from "../routes/webhook";
import { hmacSha256Hex } from "./crypto";
import { lsTimestamp } from "./time";

// Made-up test-mode catalogue ids for the simulated store.
const DEMO_STORE_ID = 90001;
const DEMO_PRODUCT_ID = 90011;
export const DEMO_VARIANT_ID = 90021;

export interface DemoSubscriptionEvent {
  eventName: "subscription_created" | "subscription_cancelled" | "subscription_expired";
  subscriptionId: string;
  playerId: string;
  status: "active" | "cancelled" | "expired";
  createdAt: number;
  updatedAt: number;
  renewsAt: number;
  endsAt: number | null;
}

export function newDemoSubscriptionId(): string {
  const [high = 0, low = 0] = crypto.getRandomValues(new Uint32Array(2));
  return String((high % 900_000) * 1_000_000 + (low % 1_000_000) + 100_000_000_000);
}

const STATUS_FORMATTED = { active: "Active", cancelled: "Cancelled", expired: "Expired" } as const;

// Mirrors the JSON:API shape Lemon Squeezy posts for subscription events, in test mode.
// user_name and user_email are present but empty: the demo never invents personal data.
export function demoSubscriptionPayload(e: DemoSubscriptionEvent) {
  const numericId = Number(e.subscriptionId);
  return {
    meta: {
      test_mode: true,
      event_name: e.eventName,
      custom_data: { player_id: e.playerId },
    },
    data: {
      type: "subscriptions",
      id: e.subscriptionId,
      attributes: {
        store_id: DEMO_STORE_ID,
        customer_id: numericId + 1,
        order_id: numericId + 2,
        order_item_id: numericId + 3,
        product_id: DEMO_PRODUCT_ID,
        variant_id: DEMO_VARIANT_ID,
        product_name: "Scanfield Pro",
        variant_name: "Monthly",
        user_name: "",
        user_email: "",
        status: e.status,
        status_formatted: STATUS_FORMATTED[e.status],
        card_brand: "visa",
        card_last_four: "4242",
        payment_processor: "stripe",
        pause: null,
        cancelled: e.status !== "active",
        trial_ends_at: null,
        billing_anchor: new Date(e.createdAt).getUTCDate(),
        first_subscription_item: null,
        urls: { update_payment_method: "", customer_portal: "", customer_portal_update_subscription: "" },
        renews_at: lsTimestamp(e.renewsAt),
        ends_at: e.endsAt === null ? null : lsTimestamp(e.endsAt),
        created_at: lsTimestamp(e.createdAt),
        updated_at: lsTimestamp(e.updatedAt),
        test_mode: true,
      },
      links: { self: `https://api.lemonsqueezy.com/v1/subscriptions/${e.subscriptionId}` },
    },
  };
}

// Signs the exact bytes it sends and hands them to the public webhook handler in-process,
// so the demo exercises the same verification, dedupe and upsert path as a real delivery.
export async function deliverDemoEvent(env: Env, secret: string, event: DemoSubscriptionEvent): Promise<Response> {
  const body = JSON.stringify(demoSubscriptionPayload(event));
  const request = new Request("https://demo.internal/api/webhooks/lemonsqueezy", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-event-name": event.eventName,
      "x-signature": await hmacSha256Hex(secret, body),
    },
    body,
  });
  return handleLemonSqueezyWebhook(request, env);
}
