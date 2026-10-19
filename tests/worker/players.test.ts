import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { call, jsonInit, newPlayer } from "./helpers";

describe("POST /api/players", () => {
  it("creates an anonymous player and stores only a hash of the token", async () => {
    const res = await call("/api/players", jsonInit("POST", { nickname: "  Seoul  Lions 7 " }));
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");

    const body = await res.json<{ id: string; token: string; nickname: string }>();
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.nickname).toBe("Seoul Lions 7");

    const row = await env.DB.prepare("SELECT * FROM players WHERE id = ?").bind(body.id).first<Record<string, unknown>>();
    expect(row?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(body.token);
  });

  it.each([
    ["too short", "a"],
    ["too long", "x".repeat(17)],
    ["email", "fan@example.com"],
    ["email without dot", "fan@example"],
    ["dot com", "fanexample.com"],
    ["www", "www fan site"],
    ["http", "http-guy"],
    ["digit run", "Ace 123456"],
    ["phone split by separators", "010 1234-5678"],
    ["only spaces", "    "],
    ["markup", "<b>Ace</b>"],
    ["not a string", 12345],
    ["missing", undefined],
  ])("rejects a nickname that is %s", async (_label, nickname) => {
    const before = await env.DB.prepare("SELECT count(*) AS n FROM players").first<{ n: number }>();
    const res = await call("/api/players", jsonInit("POST", { nickname }));
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
    const after = await env.DB.prepare("SELECT count(*) AS n FROM players").first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
  });

  it("requires a JSON content type", async () => {
    const res = await call("/api/players", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
    expect(res.status).toBe(415);
  });

  it("rejects malformed JSON", async () => {
    const res = await call("/api/players", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{nickname:",
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/me", () => {
  it("returns the player for a valid token", async () => {
    const player = await newPlayer("Keeper");
    const res = await call("/api/me", jsonInit("GET", undefined, player.token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: player.id, nickname: "Keeper", plan: "free", subscription: null });
  });

  it.each([
    ["no header", undefined],
    ["unknown token", `Bearer ${"A".repeat(43)}`],
    ["malformed token", "Bearer abc"],
    ["wrong scheme", "Basic dXNlcjpwYXNz"],
  ])("answers 401 with %s", async (_label, authorization) => {
    const res = await call("/api/me", authorization ? { headers: { authorization } } : {});
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});
