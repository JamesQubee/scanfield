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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      const row = await env.DB.prepare("SELECT count(*) AS n FROM players").first<{ n: number }>();
      return Response.json({ ok: true, players: row?.n ?? 0 });
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
