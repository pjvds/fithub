import { Hono } from "hono";
import { Resource } from "sst";
import { ErrorCode, LogEvent } from "@fithub/core";
import { authMiddleware, type AuthVariables } from "./middleware/auth.js";
import { correlationMiddleware, type CorrelationVariables } from "./middleware/correlation.js";
import { loggerMiddleware, type LoggerVariables } from "./middleware/logger.js";
import { connectionsRouter } from "./routes/connections.js";
import { createWebhooksRouter } from "./routes/webhooks.js";
import { createActivitiesRouter } from "./routes/activities.js";
import { createSyncRouter } from "./routes/sync.js";

interface AppEnv {
  Bindings: Record<string, never>;
  Variables: AuthVariables & CorrelationVariables & LoggerVariables;
}

const stage = (Resource as unknown as { App?: { stage?: string } }).App?.stage ?? "unknown";

const app = new Hono<AppEnv>();

app.use("*", correlationMiddleware());
app.use("*", loggerMiddleware({ service: "api", env: stage }));

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

const jwksUrl = (globalThis as { OPENAUTH_JWKS_URL?: string }).OPENAUTH_JWKS_URL ?? "https://auth.fithub.app/.well-known/jwks.json";
authedRoutes.use("*", authMiddleware({ jwksUrl }));

authedRoutes.get("/me", (c) => c.json({ userId: c.get("userId") }));
authedRoutes.route("/connections", connectionsRouter);
authedRoutes.route("/activities", createActivitiesRouter());
authedRoutes.route("/sync", createSyncRouter());

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
