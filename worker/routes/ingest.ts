import type { Env } from "../env";
import { errorJson } from "../lib/http";

export interface PosthogHosts {
  POSTHOG_HOST: string;
  POSTHOG_ASSETS_HOST: string;
}

// /ingest/static/* goes to the assets host, everything else under /ingest to the API host.
// The target is built by concatenation, never by resolving a relative URL, so a path such as
// "/ingest//evil.example/x" stays a path on the PostHog host.
export function mapIngestUrl(url: URL, hosts: PosthogHosts): string | null {
  if (url.pathname !== "/ingest" && !url.pathname.startsWith("/ingest/")) return null;
  const rest = url.pathname.slice("/ingest".length) || "/";
  const host = rest.startsWith("/static/") ? hosts.POSTHOG_ASSETS_HOST : hosts.POSTHOG_HOST;
  return `${host.replace(/\/+$/, "")}${rest}${url.search}`;
}

const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

export function forwardHeaders(incoming: Headers): Headers {
  const headers = new Headers(incoming);
  const listedInConnection = (incoming.get("connection") ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  for (const name of [...HOP_BY_HOP, ...listedInConnection, "cookie", "host"]) headers.delete(name);
  for (const name of [...headers.keys()]) {
    if (name.startsWith("cf-")) headers.delete(name);
  }
  const clientIp = incoming.get("cf-connecting-ip");
  if (clientIp) headers.set("x-forwarded-for", clientIp);
  return headers;
}

export async function proxyIngest(request: Request, env: Env): Promise<Response> {
  const target = mapIngestUrl(new URL(request.url), env);
  if (!target) return errorJson(404, "not_found");
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  try {
    return await fetch(target, {
      method: request.method,
      headers: forwardHeaders(request.headers),
      body: hasBody ? request.body : null,
      redirect: "manual",
    });
  } catch {
    return errorJson(502, "analytics_upstream_unavailable");
  }
}
