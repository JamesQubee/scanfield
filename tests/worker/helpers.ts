import { env, exports } from "cloudflare:workers";
import type { CreatePlayerResponse, MomentPayload, RunPayload } from "../../src/shared/api-types";
import { handle, type Env } from "../../worker/index";

export const ORIGIN = "https://scanfield.test";
export const SIGNING_SECRET = "test-signing-secret";

export function call(path: string, init: RequestInit = {}): Promise<Response> {
  return exports.default.fetch(new Request(ORIGIN + path, init));
}

// Calls the handler directly so a test can change vars such as DEMO_MODE.
export function callWithEnv(overrides: Partial<Env>, path: string, init: RequestInit = {}): Promise<Response> {
  return handle(new Request(ORIGIN + path, init), { ...env, ...overrides });
}

export function jsonInit(method: string, body?: unknown, token?: string): RequestInit {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  return { method, headers, body: body === undefined ? undefined : JSON.stringify(body) };
}

export async function newPlayer(nickname = "Tester"): Promise<CreatePlayerResponse> {
  const res = await call("/api/players", jsonInit("POST", { nickname }));
  if (res.status !== 201) throw new Error(`player create failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export function moment(idx: number, overrides: Partial<MomentPayload> = {}): MomentPayload {
  return {
    idx,
    sceneId: `scene-${idx}`,
    skill: "scanning",
    choiceKind: "pass",
    choiceId: "p7",
    bestId: "p7",
    grade: 80,
    correct: true,
    reactionMs: 900,
    scans: 2,
    lastScanBeforeArrivalMs: 400,
    inputToFrameMs: 12.5,
    ...overrides,
  };
}

export function makeRun(overrides: Partial<RunPayload> = {}): RunPayload {
  const finishedAt = Date.now() - 1_000;
  return {
    id: crypto.randomUUID(),
    drillId: "drill-1",
    contentVersion: "2026.10.1",
    startedAt: finishedAt - 60_000,
    finishedAt,
    deviceClass: "mobile",
    moments: [moment(0), moment(1), moment(2)],
    ...overrides,
  };
}

// Independent of the Worker's own helper, so the test checks the algorithm, not itself.
export async function sign(body: string, secret = SIGNING_SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function postWebhook(body: string, signature: string | null, eventName = "subscription_created") {
  const headers: Record<string, string> = { "content-type": "application/json", "x-event-name": eventName };
  if (signature !== null) headers["x-signature"] = signature;
  return call("/api/webhooks/lemonsqueezy", { method: "POST", headers, body });
}

export async function postSigned(payload: unknown): Promise<Response> {
  const body = JSON.stringify(payload);
  const eventName = (payload as { meta: { event_name: string } }).meta.event_name;
  return postWebhook(body, await sign(body), eventName);
}

export interface SubscriptionEventOptions {
  event?: string;
  id: string;
  playerId?: string;
  status?: string;
  updatedAt: string;
  renewsAt?: string | null;
  endsAt?: string | null;
  attributes?: Record<string, unknown>;
}

export function subscriptionEvent(o: SubscriptionEventOptions) {
  return {
    meta: {
      test_mode: true,
      event_name: o.event ?? "subscription_created",
      ...(o.playerId ? { custom_data: { player_id: o.playerId } } : {}),
    },
    data: {
      type: "subscriptions",
      id: o.id,
      attributes: {
        store_id: 1,
        customer_id: 2,
        variant_id: 3,
        product_name: "Scanfield Pro",
        status: o.status ?? "active",
        renews_at: o.renewsAt === undefined ? "2099-01-01T00:00:00.000000Z" : o.renewsAt,
        ends_at: o.endsAt ?? null,
        created_at: "2026-01-01T00:00:00.000000Z",
        updated_at: o.updatedAt,
        test_mode: true,
        ...o.attributes,
      },
    },
  };
}

export function uniqueSubscriptionId(): string {
  return String(Math.floor(Math.random() * 1e12));
}

export async function subscriptionRow(id: string) {
  return env.DB.prepare("SELECT * FROM subscriptions WHERE ls_subscription_id = ?")
    .bind(id)
    .first<{ player_id: string | null; status: string; ends_at: string | null; ls_updated_at: string; test_mode: number }>();
}

export async function dumpAllTables(): Promise<string> {
  const tables = ["players", "runs", "moments", "subscriptions", "webhook_events", "checkout_sessions"];
  const rows = await Promise.all(tables.map((t) => env.DB.prepare(`SELECT * FROM ${t}`).all()));
  return JSON.stringify(rows.map((r) => r.results));
}
