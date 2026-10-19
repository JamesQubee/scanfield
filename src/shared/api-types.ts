// The contract between the game (src/) and the Worker (worker/). Both sides import it.

export type Plan = "free" | "pro";

export type ChoiceKind = "pass" | "setback" | "carry" | "space" | "timeout";

export interface CreatePlayerRequest {
  nickname: string;
}
export interface CreatePlayerResponse {
  id: string;
  token: string;
  nickname: string;
}

export interface SubscriptionInfo {
  status: string;
  renewsAt: string | null;
  endsAt: string | null;
  testMode: boolean;
}
export interface MeResponse {
  id: string;
  nickname: string;
  plan: Plan;
  subscription: SubscriptionInfo | null;
}

export interface MomentPayload {
  idx: number;
  sceneId: string;
  skill: string;
  choiceKind: ChoiceKind;
  choiceId: string | null;
  bestId: string;
  grade: number; // 0..100
  correct: boolean;
  reactionMs: number | null;
  scans: number;
  lastScanBeforeArrivalMs: number | null;
  inputToFrameMs: number | null;
}

export interface RunPayload {
  id: string; // client UUID, the idempotency key
  drillId: string;
  contentVersion: string;
  startedAt: number; // epoch ms
  finishedAt: number;
  deviceClass: string | null;
  moments: MomentPayload[];
}
export interface SaveRunResponse {
  ok: true;
  runId: string;
  duplicate: boolean;
  score: number;
}

export interface RunSummary {
  id: string;
  drillId: string;
  score: number;
  momentsCount: number;
  correctCount: number;
  avgReactionMs: number | null;
  scansTotal: number;
  finishedAt: number;
}
export interface ListRunsResponse {
  runs: RunSummary[];
  skills: { skill: string; moments: number; correct: number; avgGrade: number }[];
}

export type CheckoutResponse =
  | { mode: "live"; url: string }
  | { mode: "demo"; sessionId: string };

export interface DemoCheckoutCompleteRequest {
  sessionId: string;
}
export interface PlanResponse {
  plan: Plan;
  subscription: SubscriptionInfo | null;
}

export interface ApiError {
  error: string;
}
