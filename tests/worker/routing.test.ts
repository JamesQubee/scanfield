import { describe, expect, it } from "vitest";
import { call } from "./helpers";

describe("routing", () => {
  it("answers unknown API paths with a JSON 404", async () => {
    const res = await call("/api/nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("answers a wrong method with 405 and Allow", async () => {
    const res = await call("/api/runs", { method: "DELETE" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, POST");
  });

  it("answers 404 for anything outside /api and /ingest", async () => {
    expect((await call("/index.html")).status).toBe(404);
  });

  it("serves health as JSON", async () => {
    const res = await call("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ ok: true });
  });
});
