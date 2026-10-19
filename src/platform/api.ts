// Client for the Worker API. Saving a run never blocks play: it is queued, sent
// with keepalive (so it survives the tab closing), and retried later if offline.

import type { CheckoutResponse, CreatePlayerResponse, ListRunsResponse, MeResponse, PlanResponse, RunPayload, SaveRunResponse } from "../shared/api-types";
import { load, remove, save } from "./storage";

const PLAYER_KEY = "sf.player";
const OUTBOX_KEY = "sf.outbox";

/** What happened to a queued run. "pending" means it stays queued and will be retried. */
export type SaveStatus = { status: "saved"; res: SaveRunResponse } | { status: "rejected"; error: string } | { status: "pending" };

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

  private flushing: Promise<Map<string, SaveStatus>> | null = null;

  /** Queues the run, then sends everything queued. */
  async saveRun(run: RunPayload): Promise<SaveStatus> {
    const outbox = load<RunPayload[]>(OUTBOX_KEY, []);
    if (!outbox.some((r) => r.id === run.id)) outbox.push(run);
    save(OUTBOX_KEY, outbox.slice(-20));
    // A flush already under way may have read the outbox before this run was added.
    if (this.flushing) await this.flushing.catch(() => undefined);
    const results = await this.flush();
    return results.get(run.id) ?? { status: "pending" };
  }

  /** Sends the queued runs. Only one flush runs at a time; callers share it. */
  flush(): Promise<Map<string, SaveStatus>> {
    if (!this.flushing) this.flushing = this.sendQueued().finally(() => (this.flushing = null));
    return this.flushing;
  }

  private async sendQueued(): Promise<Map<string, SaveStatus>> {
    const done = new Map<string, SaveStatus>();
    for (const run of load<RunPayload[]>(OUTBOX_KEY, [])) {
      try {
        // keepalive lets the request finish even if the page is closing.
        const res = await this.authed<SaveRunResponse>("/api/runs", { method: "POST", body: JSON.stringify(run), keepalive: true });
        done.set(run.id, { status: "saved", res });
      } catch (e) {
        // The server said no (bad payload, not allowed): retrying will not help, so stop
        // retrying, but report it rather than pretend it was saved.
        if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) done.set(run.id, { status: "rejected", error: e.message });
        else break;
      }
    }
    // Re-read: a run queued while we were sending must stay queued.
    save(OUTBOX_KEY, load<RunPayload[]>(OUTBOX_KEY, []).filter((r) => !done.has(r.id)));
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
