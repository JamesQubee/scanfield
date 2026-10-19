import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { CheckoutResponse, MeResponse, PlanResponse } from "../../src/shared/api-types";
import { liveCheckoutUrl } from "../../worker/routes/checkout";
import { call, callWithEnv, jsonInit, newPlayer } from "./helpers";

async function startDemoCheckout(token: string): Promise<string> {
  const res = await call("/api/checkout", jsonInit("POST", undefined, token));
  expect(res.status).toBe(201);
  const body = await res.json<CheckoutResponse>();
  if (body.mode !== "demo") throw new Error("expected demo mode");
  return body.sessionId;
}

function complete(token: string, sessionId: string) {
  return call("/api/demo/checkout/complete", jsonInit("POST", { sessionId }, token));
}

async function me(token: string): Promise<MeResponse> {
  return (await call("/api/me", jsonInit("GET", undefined, token))).json();
}

describe("demo checkout", () => {
  it("goes checkout -> complete -> pro, through a signed test-mode webhook", async () => {
    const player = await newPlayer();
    const sessionId = await startDemoCheckout(player.token);

    const res = await complete(player.token, sessionId);
    expect(res.status).toBe(200);
    const plan = await res.json<PlanResponse>();
    expect(plan.plan).toBe("pro");
    expect(plan.subscription).toMatchObject({ status: "active", endsAt: null, testMode: true });
    expect((await me(player.token)).plan).toBe("pro");

    const events = await env.DB.prepare(
      `SELECT e.event_name, e.result FROM webhook_events e
       JOIN subscriptions s ON s.ls_subscription_id = e.ls_object_id WHERE s.player_id = ?`,
    )
      .bind(player.id)
      .all();
    expect(events.results).toEqual([{ event_name: "subscription_created", result: "applied" }]);
  });

  it("refuses to complete the same session twice", async () => {
    const player = await newPlayer();
    const sessionId = await startDemoCheckout(player.token);
    expect((await complete(player.token, sessionId)).status).toBe(200);

    const second = await complete(player.token, sessionId);
    expect(second.status).toBe(409);
    const count = await env.DB.prepare("SELECT count(*) AS n FROM subscriptions WHERE player_id = ?")
      .bind(player.id)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("does not let a player complete someone else's session", async () => {
    const owner = await newPlayer("Owner");
    const other = await newPlayer("Other");
    const sessionId = await startDemoCheckout(owner.token);
    expect((await complete(other.token, sessionId)).status).toBe(404);
    expect((await complete(owner.token, crypto.randomUUID())).status).toBe(404);
    expect((await complete(owner.token, "not-a-uuid")).status).toBe(400);
  });

  it("cancels back to free", async () => {
    const player = await newPlayer();
    await complete(player.token, await startDemoCheckout(player.token));

    const res = await call("/api/demo/subscription/cancel", jsonInit("POST", undefined, player.token));
    expect(res.status).toBe(200);
    const plan = await res.json<PlanResponse>();
    expect(plan.plan).toBe("free");
    expect(plan.subscription?.status).toBe("expired");
    expect((await me(player.token)).plan).toBe("free");

    const again = await call("/api/demo/subscription/cancel", jsonInit("POST", undefined, player.token));
    expect(again.status).toBe(409);
  });

  it("can subscribe again after cancelling", async () => {
    const player = await newPlayer();
    await complete(player.token, await startDemoCheckout(player.token));
    await call("/api/demo/subscription/cancel", jsonInit("POST", undefined, player.token));
    const res = await complete(player.token, await startDemoCheckout(player.token));
    expect((await res.json<PlanResponse>()).plan).toBe("pro");
  });

  it("hides the demo routes when DEMO_MODE is not 1", async () => {
    const player = await newPlayer();
    const sessionId = await startDemoCheckout(player.token);
    const off = { DEMO_MODE: "0" };

    const done = await callWithEnv(off, "/api/demo/checkout/complete", jsonInit("POST", { sessionId }, player.token));
    expect(done.status).toBe(404);
    const cancel = await callWithEnv(off, "/api/demo/subscription/cancel", jsonInit("POST", undefined, player.token));
    expect(cancel.status).toBe(404);
    const anonymous = await callWithEnv(off, "/api/demo/subscription/cancel", { method: "POST" });
    expect(anonymous.status).toBe(404);
  });
});

describe("live checkout", () => {
  it("returns the store link with the player id as custom data", async () => {
    const player = await newPlayer();
    const res = await callWithEnv(
      { DEMO_MODE: "0", LS_STORE_URL: "https://scanfield.lemonsqueezy.com/buy/0b7c1e2a-1111-2222-3333-444455556666" },
      "/api/checkout",
      jsonInit("POST", undefined, player.token),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      mode: "live",
      url: `https://scanfield.lemonsqueezy.com/buy/0b7c1e2a-1111-2222-3333-444455556666?checkout[custom][player_id]=${player.id}`,
    });
  });

  it("answers 503 when no store link is configured", async () => {
    const player = await newPlayer();
    const res = await callWithEnv({ DEMO_MODE: "0", LS_STORE_URL: "" }, "/api/checkout", jsonInit("POST", undefined, player.token));
    expect(res.status).toBe(503);
  });

  it("keeps existing query parameters and encodes the value", () => {
    expect(liveCheckoutUrl("https://s.lemonsqueezy.com/buy/abc?embed=1", "a b&c")).toBe(
      "https://s.lemonsqueezy.com/buy/abc?embed=1&checkout[custom][player_id]=a%20b%26c",
    );
  });
});
