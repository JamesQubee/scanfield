import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { MeResponse } from "../../src/shared/api-types";
import {
  call,
  callWithEnv,
  dumpAllTables,
  jsonInit,
  newPlayer,
  postSigned,
  postWebhook,
  sign,
  subscriptionEvent,
  subscriptionRow,
  uniqueSubscriptionId,
} from "./helpers";

async function plan(token: string) {
  return (await (await call("/api/me", jsonInit("GET", undefined, token))).json<MeResponse>()).plan;
}

async function eventCount(): Promise<number> {
  return (await env.DB.prepare("SELECT count(*) AS n FROM webhook_events").first<{ n: number }>())?.n ?? 0;
}

describe("POST /api/webhooks/lemonsqueezy", () => {
  it("stores a signed subscription event and upgrades the player", async () => {
    const player = await newPlayer();
    const id = uniqueSubscriptionId();
    const res = await postSigned(subscriptionEvent({ id, playerId: player.id, updatedAt: "2026-10-01T10:00:00.000000Z" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, duplicate: false, result: "applied" });

    expect(await subscriptionRow(id)).toMatchObject({
      player_id: player.id,
      status: "active",
      test_mode: 1,
      ls_updated_at: "2026-10-01T10:00:00.000000Z",
    });
    const me = await (await call("/api/me", jsonInit("GET", undefined, player.token))).json<MeResponse>();
    expect(me.plan).toBe("pro");
    expect(me.subscription).toEqual({
      status: "active",
      renewsAt: "2099-01-01T00:00:00.000Z",
      endsAt: null,
      testMode: true,
    });
  });

  it("rejects a bad signature with 401 and stores nothing", async () => {
    const player = await newPlayer();
    const id = uniqueSubscriptionId();
    const body = JSON.stringify(subscriptionEvent({ id, playerId: player.id, updatedAt: "2026-10-01T10:00:00Z" }));
    const before = await eventCount();

    for (const signature of [await sign(body, "some-other-secret"), "zz", "", (await sign(body)).slice(0, 62)]) {
      const res = await postWebhook(body, signature);
      expect(res.status).toBe(401);
    }
    const tampered = body.replace('"active"', '"on_trial"');
    expect((await postWebhook(tampered, await sign(body))).status).toBe(401);

    expect(await subscriptionRow(id)).toBeNull();
    expect(await eventCount()).toBe(before);
    expect(await plan(player.token)).toBe("free");
  });

  it("rejects a missing signature with 401", async () => {
    const body = JSON.stringify(subscriptionEvent({ id: uniqueSubscriptionId(), updatedAt: "2026-10-01T10:00:00Z" }));
    const res = await postWebhook(body, null);
    expect(res.status).toBe(401);
  });

  it("rejects every delivery when the signing secret is not configured", async () => {
    const body = JSON.stringify(subscriptionEvent({ id: uniqueSubscriptionId(), updatedAt: "2026-10-01T10:00:00Z" }));
    const res = await callWithEnv({ LS_SIGNING_SECRET: undefined }, "/api/webhooks/lemonsqueezy", {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": await sign(body) },
      body,
    });
    expect(res.status).toBe(401);
  });

  it("answers duplicate:true for the same body and does nothing else", async () => {
    const player = await newPlayer();
    const id = uniqueSubscriptionId();
    const payload = subscriptionEvent({ id, playerId: player.id, updatedAt: "2026-10-02T10:00:00.000000Z" });
    expect((await postSigned(payload)).status).toBe(200);
    const before = await eventCount();

    const again = await postSigned(payload);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ ok: true, duplicate: true });
    expect(await eventCount()).toBe(before);
  });

  it("does not let an older event overwrite a newer one", async () => {
    const player = await newPlayer();
    const id = uniqueSubscriptionId();
    await postSigned(subscriptionEvent({ id, playerId: player.id, status: "active", updatedAt: "2026-10-03T12:00:00.000000Z" }));

    const late = await postSigned(
      subscriptionEvent({
        id,
        playerId: player.id,
        event: "subscription_expired",
        status: "expired",
        endsAt: "2026-10-03T11:00:00.000000Z",
        updatedAt: "2026-10-03T11:00:00.000000Z",
      }),
    );
    expect(await late.json()).toEqual({ ok: true, duplicate: false, result: "stale" });
    expect(await subscriptionRow(id)).toMatchObject({ status: "active", ls_updated_at: "2026-10-03T12:00:00.000000Z" });
    expect(await plan(player.token)).toBe("pro");

    // Same instant written with millisecond precision still compares correctly.
    await postSigned(
      subscriptionEvent({ id, event: "subscription_updated", status: "past_due", updatedAt: "2026-10-03T12:00:00.001Z" }),
    );
    expect(await subscriptionRow(id)).toMatchObject({ status: "past_due", ls_updated_at: "2026-10-03T12:00:00.001000Z" });
  });

  it("keeps the player link when a later event has no custom data", async () => {
    const player = await newPlayer();
    const id = uniqueSubscriptionId();
    await postSigned(subscriptionEvent({ id, playerId: player.id, updatedAt: "2026-10-04T10:00:00.000000Z" }));
    await postSigned(
      subscriptionEvent({
        id,
        event: "subscription_cancelled",
        status: "cancelled",
        endsAt: "2099-02-01T00:00:00.000000Z",
        updatedAt: "2026-10-04T11:00:00.000000Z",
      }),
    );
    expect(await subscriptionRow(id)).toMatchObject({ player_id: player.id, status: "cancelled" });
    expect(await plan(player.token)).toBe("pro");
  });

  it("ignores a custom player_id that does not exist", async () => {
    const player = await newPlayer();
    const id = uniqueSubscriptionId();
    await postSigned(subscriptionEvent({ id, playerId: player.id, updatedAt: "2026-10-05T10:00:00.000000Z" }));
    await postSigned(
      subscriptionEvent({
        id,
        playerId: crypto.randomUUID(),
        event: "subscription_updated",
        updatedAt: "2026-10-05T11:00:00.000000Z",
      }),
    );
    expect(await subscriptionRow(id)).toMatchObject({ player_id: player.id });
  });

  it("records an unknown event and answers 200", async () => {
    const payload = { meta: { event_name: "affiliate_activated" }, data: { type: "affiliates", id: "77", attributes: {} } };
    const res = await postSigned(payload);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, duplicate: false, result: "ignored" });
    const row = await env.DB.prepare("SELECT event_name, ls_object_id, result FROM webhook_events WHERE event_name = ?")
      .bind("affiliate_activated")
      .first();
    expect(row).toEqual({ event_name: "affiliate_activated", ls_object_id: "77", result: "ignored" });
  });

  it("never stores the customer's name or email", async () => {
    const player = await newPlayer();
    const id = uniqueSubscriptionId();
    const res = await postSigned(
      subscriptionEvent({
        id,
        playerId: player.id,
        updatedAt: "2026-10-06T10:00:00.000000Z",
        attributes: {
          user_name: "Fanny Fanson",
          user_email: "fan@example.com",
          card_last_four: "9876",
          urls: { customer_portal: "https://scanfield.lemonsqueezy.com/billing?expires=1&signature=secretsig" },
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(await subscriptionRow(id)).not.toBeNull();

    const everything = await dumpAllTables();
    for (const personal of ["fan@example.com", "Fanny", "Fanson", "9876", "secretsig"]) {
      expect(everything).not.toContain(personal);
    }
  });

  it("rejects a body over 256 KB", async () => {
    const body = JSON.stringify({ meta: { event_name: "order_created" }, pad: "x".repeat(257 * 1024) });
    const res = await postWebhook(body, await sign(body));
    expect(res.status).toBe(413);
  });
});
