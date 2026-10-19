import type { Env, Handler } from "./env";
import { authed } from "./lib/auth";
import { errorJson, HttpError } from "./lib/http";
import { createCheckout } from "./routes/checkout";
import { cancelDemoSubscription, completeDemoCheckout, demoOnly } from "./routes/demo";
import { health } from "./routes/health";
import { proxyIngest } from "./routes/ingest";
import { createPlayer, getMe } from "./routes/players";
import { listRuns, saveRun } from "./routes/runs";
import { handleLemonSqueezyWebhook } from "./routes/webhook";

export type { Env } from "./env";

const routes: Record<string, Record<string, Handler>> = {
  "/api/health": { GET: health },
  "/api/players": { POST: createPlayer },
  "/api/me": { GET: authed(getMe) },
  "/api/runs": { GET: authed(listRuns), POST: authed(saveRun) },
  "/api/checkout": { POST: authed(createCheckout) },
  "/api/demo/checkout/complete": { POST: demoOnly(authed(completeDemoCheckout)) },
  "/api/demo/subscription/cancel": { POST: demoOnly(authed(cancelDemoSubscription)) },
  "/api/webhooks/lemonsqueezy": { POST: (c) => handleLemonSqueezyWebhook(c.request, c.env) },
};

async function route(request: Request, env: Env, url: URL, ctx?: ExecutionContext): Promise<Response> {
  if (url.pathname === "/ingest" || url.pathname.startsWith("/ingest/")) return proxyIngest(request, env);

  const methods = Object.hasOwn(routes, url.pathname) ? routes[url.pathname] : undefined;
  if (!methods) return errorJson(404, "not_found");
  const handler = Object.hasOwn(methods, request.method) ? methods[request.method] : undefined;
  if (!handler) return errorJson(405, "method_not_allowed", { allow: Object.keys(methods).join(", ") });
  return handler({ request, env, url, ctx });
}

export async function handle(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  try {
    return await route(request, env, new URL(request.url), ctx);
  } catch (err) {
    if (err instanceof HttpError) return errorJson(err.status, err.message);
    console.error("unhandled error", err instanceof Error ? err.message : "unknown");
    return errorJson(500, "internal_error");
  }
}

export default { fetch: handle } satisfies ExportedHandler<Env>;
