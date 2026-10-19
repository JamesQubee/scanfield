import { describe, expect, it } from "vitest";
import { forwardHeaders, mapIngestUrl } from "../../worker/routes/ingest";

const hosts = { POSTHOG_HOST: "https://us.i.posthog.com", POSTHOG_ASSETS_HOST: "https://us-assets.i.posthog.com/" };
const map = (path: string) => mapIngestUrl(new URL(`https://scanfield.test${path}`), hosts);

describe("mapIngestUrl", () => {
  it("sends static files to the assets host", () => {
    expect(map("/ingest/static/array.js?v=1.2")).toBe("https://us-assets.i.posthog.com/static/array.js?v=1.2");
  });

  it("sends everything else to the API host with the query string", () => {
    expect(map("/ingest/e/?ip=1&_=1760000000000&ver=1.438.12")).toBe(
      "https://us.i.posthog.com/e/?ip=1&_=1760000000000&ver=1.438.12",
    );
    expect(map("/ingest/flags/?v=2")).toBe("https://us.i.posthog.com/flags/?v=2");
    expect(map("/ingest")).toBe("https://us.i.posthog.com/");
    expect(map("/ingest/static")).toBe("https://us.i.posthog.com/static");
  });

  it("keeps a protocol-relative looking path on the PostHog host", () => {
    const target = map("/ingest//evil.example/steal");
    expect(target).toBe("https://us.i.posthog.com//evil.example/steal");
    expect(new URL(target!).host).toBe("us.i.posthog.com");
  });

  it("ignores paths outside /ingest", () => {
    expect(map("/api/me")).toBeNull();
    expect(map("/ingestion/e")).toBeNull();
  });
});

describe("forwardHeaders", () => {
  it("drops cookies, hop-by-hop and Cloudflare headers and forwards the client IP", () => {
    const out = forwardHeaders(
      new Headers({
        cookie: "session=1",
        connection: "keep-alive, x-custom-hop",
        "keep-alive": "timeout=5",
        "x-custom-hop": "1",
        "transfer-encoding": "chunked",
        "cf-connecting-ip": "203.0.113.9",
        "cf-ray": "abc",
        "content-type": "application/json",
        "user-agent": "test",
      }),
    );
    expect([...out.keys()].sort()).toEqual(["content-type", "user-agent", "x-forwarded-for"]);
    expect(out.get("x-forwarded-for")).toBe("203.0.113.9");
  });
});
