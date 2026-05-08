import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { Resource } from "sst";
import { users, connections, logAuditEvent, LogEvent } from "@fithub/core";
import type { AuthVariables } from "../middleware/auth.js";
import type { LoggerVariables } from "../middleware/logger.js";
import type { CorrelationVariables } from "../middleware/correlation.js";
import type { UserProfile, ExportRequestResponse } from "@fithub/core";

interface AppEnv {
  Bindings: Record<string, never>;
  Variables: AuthVariables & LoggerVariables & CorrelationVariables;
}

interface Res {
  FithubDb: D1Database;
}

function getResource(): Res {
  return Resource as unknown as Res;
}

export function createUserRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  /**
   * GET /api/user/profile
   * Returns the authenticated user's profile and connections.
   */
  router.get("/profile", async (c) => {
    const userId = c.get("userId");
    const r = getResource();
    const db = drizzle(r.FithubDb);

    const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const user = userRows[0];
    if (!user) {
      return c.json({ error: "user_not_found" }, 404);
    }

    const connRows = await db.select().from(connections).where(eq(connections.userId, userId));

    const profile: UserProfile = {
      user_id: user.id,
      email: user.email,
      display_name: user.displayName,
      created_at: Math.floor(user.createdAt.getTime() / 1000),
      connections: connRows.map((row) => ({
        id: row.id,
        platform: row.platform as "strava" | "apple_health",
        status: mapStatus(row.status),
        connected_at: Math.floor(row.createdAt.getTime() / 1000),
        last_synced_at: null,
        last_error: null,
      })),
    };

    return c.json(profile);
  });

  /**
   * POST /api/user/export
   * Accepts a data export request (async; actual export deferred).
   */
  router.post("/export", async (c) => {
    const userId = c.get("userId");
    const log = c.get("logger");
    const r = getResource();
    const db = drizzle(r.FithubDb);

    log.info(LogEvent.apiRequestStarted, { action: "export.requested", userId });
    await logAuditEvent(db, { userId, eventType: "user.export.requested" });

    const response: ExportRequestResponse = {
      accepted: true,
      message: "Your export request has been received. You will be notified when it is ready.",
    };
    return c.json(response);
  });

  /**
   * DELETE /api/user
   * Permanently deletes the authenticated user and all associated data.
   */
  router.delete("/", async (c) => {
    const userId = c.get("userId");
    const log = c.get("logger");
    const r = getResource();
    const db = drizzle(r.FithubDb);

    log.info(LogEvent.apiRequestStarted, { action: "account.delete", userId });
    await logAuditEvent(db, { userId, eventType: "user.account.deleted" });

    // Cascade deletes connections, activities, sources, etc.
    await db.delete(users).where(eq(users.id, userId));

    return c.body(null, 204);
  });

  return router;
}

function mapStatus(status: "active" | "degraded" | "revoked"): "active" | "requires_reauth" | "disconnected" {
  if (status === "degraded") return "requires_reauth";
  if (status === "revoked") return "disconnected";
  return "active";
}
