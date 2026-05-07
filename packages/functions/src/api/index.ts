import { Hono } from "hono";
import { cors } from "hono/cors";
import { Resource } from "sst";
import { createClient } from "@openauthjs/openauth/client";
import { ErrorCode, LogEvent } from "@fithub/core";
import { authMiddleware, type AuthVariables } from "./middleware/auth.js";
import { correlationMiddleware, type CorrelationVariables } from "./middleware/correlation.js";
import { loggerMiddleware, type LoggerVariables } from "./middleware/logger.js";
import { connectionsRouter } from "./routes/connections.js";
import { createWebhooksRouter } from "./routes/webhooks.js";
import { createActivitiesRouter } from "./routes/activities.js";
import { createSyncRouter } from "./routes/sync.js";
import { createDedupRouter } from "./routes/dedup.js";

interface AppEnv {
  Bindings: {
    Auth: { fetch: typeof fetch };
  };
  Variables: AuthVariables & CorrelationVariables & LoggerVariables;
}

const stage = (Resource as unknown as { App?: { stage?: string } }).App?.stage ?? "unknown";

const app = new Hono<AppEnv>();

app.use("*", correlationMiddleware());
app.use("*", loggerMiddleware({ service: "api", env: stage }));
app.use("*", cors({
  origin: ["https://app.fithub.space", "http://localhost:4321"],
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "X-Correlation-Id", "X-Request-Id"],
  credentials: true,
}));

app.use("*", async (c, next) => {
  const start = Date.now();
  const log = c.get("logger");
  log.info(LogEvent.apiRequestStarted, { method: c.req.method, path: c.req.path });
  await next();
  log.info(LogEvent.apiRequestCompleted, {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Date.now() - start,
  });
});

app.get("/health", (c) =>
  c.json({
    status: "ok",
    version: "0.1.0",
    stage,
  }),
);

// Unauthenticated webhook routes
app.route("/api/webhooks", createWebhooksRouter());

const authedRoutes = new Hono<AppEnv>();

authedRoutes.use("*", async (c, next) => {
  // Build an OpenAuth client that routes through the Auth service binding.
  // The service binding (env.Auth) routes calls within Cloudflare's network
  // at sub-millisecond latency — no public egress, no HTTP round-trip.
  // X-Request-ID is propagated so cross-service traces can be correlated.
  const authBinding = c.env.Auth;
  const requestId = c.req.header("x-request-id");

  const client = createClient({
    clientID: "api",
    issuer: (Resource as unknown as { Auth?: { url?: string } }).Auth?.url ?? "",
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers((init as RequestInit | undefined)?.headers);
      if (requestId) headers.set("x-request-id", requestId);
      return authBinding.fetch(input as Parameters<typeof fetch>[0], { ...(init ?? {}), headers });
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (authMiddleware({ client }) as (c: any, next: any) => Promise<Response>)(c, next);
});

authedRoutes.get("/me", (c) => c.json({ userId: c.get("userId") }));
authedRoutes.route("/connections", connectionsRouter);
authedRoutes.route("/activities", createActivitiesRouter());
authedRoutes.route("/sync", createSyncRouter());
authedRoutes.route("/dedup", createDedupRouter());

app.route("/api", authedRoutes);

app.notFound((c) => c.json({ error: "not_found" }, 404));

app.onError((err, c) => {
  c.get("logger").error(LogEvent.apiRequestFailed, {
    code: ErrorCode.INTERNAL,
    err,
    method: c.req.method,
    path: c.req.path,
  });
  return c.json({ error: "internal_error" }, 500);
});

export default app;
