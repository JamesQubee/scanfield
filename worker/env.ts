export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  DEMO_MODE?: string;
  LS_SIGNING_SECRET?: string;
  TOKEN_PEPPER?: string;
  POSTHOG_HOST: string;
  POSTHOG_ASSETS_HOST: string;
  LS_STORE_URL?: string;
}

export interface RouteContext {
  request: Request;
  env: Env;
  url: URL;
  ctx?: ExecutionContext;
}

export type Handler = (c: RouteContext) => Promise<Response>;
