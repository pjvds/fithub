import { Hono } from "hono";
import { Resource } from "sst";
import { authMiddleware, type AuthVariables } from "./middleware/auth.js";

interface AppEnv {
  Bindings: Record<string, never>;
  Variables: AuthVariables;
}

const app = new Hono<AppEnv>();

app.get("/health", (c) =>
  c.json({
    status: "ok",
    version: "0.1.0",
    stage: (Resource as unknown as { App?: { stage?: string } }).App?.stage ?? "unknown",
  }),
);

const authedRoutes = new Hono<AppEnv>();

const jwksUrl = (globalThis as { OPENAUTH_JWKS_URL?: string }).OPENAUTH_JWKS_URL ?? "https://auth.fithub.app/.well-known/jwks.json";
authedRoutes.use("*", authMiddleware({ jwksUrl }));

authedRoutes.get("/me", (c) => c.json({ userId: c.get("userId") }));

app.route("/api", authedRoutes);

app.notFound((c) => c.json({ error: "not_found" }, 404));

app.onError((err, c) => {
  console.error("api error", err);
  return c.json({ error: "internal_error" }, 500);
});

export default app;
