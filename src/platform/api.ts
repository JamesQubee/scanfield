// Client for the Worker API. Saving a run never blocks play: it is queued, sent
// with keepalive (so it survives the tab closing), and retried later if offline.

import type { CheckoutResponse, CreatePlayerResponse, ListRunsResponse, MeResponse, PlanResponse, RunPayload, SaveRunResponse } from "../shared/api-types";
import { load, remove, save } from "./storage";

const PLAYER_KEY = "sf.player";
const OUTBOX_KEY = "sf.outbox";

export interface LocalPlayer {
  id: string;
  token: string;
  nickname: string;
}

const ADJ = ["Swift", "Calm", "Sharp", "Bold", "Quick", "Bright", "Clever", "Steady"];
const NOUN = ["Falcon", "Fox", "Otter", "Lynx", "Hawk", "Wolf", "Tiger", "Comet"];

export function randomNickname(): string {
  const r = (n: number) => Math.floor(Math.random() * n);
  return `${ADJ[r(ADJ.length)]} ${NOUN[r(NOUN.length)]}`;
}

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  const res = await fetch(path, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(8000) });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class Api {
  player: LocalPlayer | null = load<LocalPlayer | null>(PLAYER_KEY, null);

  async ensurePlayer(): Promise<LocalPlayer> {
    if (this.player) return this.player;
    const p = await call<CreatePlayerResponse>("/api/players", { method: "POST", body: JSON.stringify({ nickname: randomNickname() }) });
    this.player = { id: p.id, token: p.token, nickname: p.nickname };
    save(PLAYER_KEY, this.player);
    return this.player;
  }

  private async authed<T>(path: string, init: RequestInit = {}): Promise<T> {
    const p = await this.ensurePlayer();
    try {
      return await call<T>(path, { ...init, token: p.token });
    } catch (e) {
      // The local token no longer matches the server (database reset): start again.
      if (e instanceof ApiError && e.status === 401) {
        this.forget();
        const q = await this.ensurePlayer();
        return call<T>(path, { ...init, token: q.token });
      }
      throw e;
    }
  }

  forget(): void {
    this.player = null;
    remove(PLAYER_KEY);
  }

  me(): Promise<MeResponse> {
    return this.authed<MeResponse>("/api/me");
  }

  runs(): Promise<ListRunsResponse> {
    return this.authed<ListRunsResponse>("/api/runs");
  }

  /** Queues the run, then tries to send everything queued. Resolves with this run's result if it went through. */
  async saveRun(run: RunPayload): Promise<SaveRunResponse | null> {
    const outbox = load<RunPayload[]>(OUTBOX_KEY, []);
    if (!outbox.some((r) => r.id === run.id)) outbox.push(run);
    save(OUTBOX_KEY, outbox.slice(-20));
    const results = await this.flush();
    return results.get(run.id) ?? null;
  }

  async flush(): Promise<Map<string, SaveRunResponse>> {
    const done = new Map<string, SaveRunResponse>();
    const outbox = load<RunPayload[]>(OUTBOX_KEY, []);
    for (const run of outbox) {
      try {
        // keepalive lets the request finish even if the page is closing.
        done.set(run.id, await this.authed<SaveRunResponse>("/api/runs", { method: "POST", body: JSON.stringify(run), keepalive: true }));
      } catch (e) {
        // A 4xx will never succeed: drop it rather than retry forever.
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) done.set(run.id, { ok: true, runId: run.id, duplicate: false, score: -1 });
        else break;
      }
    }
    save(OUTBOX_KEY, outbox.filter((r) => !done.has(r.id)));
    return done;
  }

  checkout(): Promise<CheckoutResponse> {
    return this.authed<CheckoutResponse>("/api/checkout", { method: "POST" });
  }

  completeDemoCheckout(sessionId: string): Promise<PlanResponse> {
    return this.authed<PlanResponse>("/api/demo/checkout/complete", { method: "POST", body: JSON.stringify({ sessionId }) });
  }

  cancelDemoSubscription(): Promise<PlanResponse> {
    return this.authed<PlanResponse>("/api/demo/subscription/cancel", { method: "POST" });
  }
}
