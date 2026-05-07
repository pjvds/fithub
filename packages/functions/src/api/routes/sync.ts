import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import { Resource } from "sst";
import { connections, createLogger, LogEvent } from "@fithub/core";
import type { AuthVariables } from "../middleware/auth.js";
import type { LoggerVariables } from "../middleware/logger.js";
import type { CorrelationVariables } from "../middleware/correlation.js";
import type { SyncJobMessage } from "../../worker/index.js";

interface AppEnv {
  Bindings: Record<string, never>;
  Variables: AuthVariables & LoggerVariables & CorrelationVariables;
}

type SyncEnv = {
  USER_SYNC_COORDINATOR: DurableObjectNamespace;
};

export function createSyncRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  /**
   * POST /api/sync/trigger
   * Manually triggers a sync for a given platform connection.
   * Returns 409 if a sync job is already in-flight for that platform.
   *
   * Body: { platform: "strava" }
   */
  router.post("/trigger", async (c) => {
    const userId = c.var.userId;
    const r = Resource as unknown as {
      FithubDb: D1Database;
      SyncJobs: Queue<SyncJobMessage>;
      App?: { stage?: string };
    };
    const stage = (Resource as unknown as { App?: { stage?: string } }).App?.stage ?? "unknown";
    const log = createLogger({ service: "api", env: stage, correlationId: c.var.correlationId ?? "none" });
    const db = drizzle(r.FithubDb);

    let body: { platform?: string };
    try {
      body = await c.req.json<{ platform?: string }>();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }

    const platform = body.platform;
    if (!platform || !["strava"].includes(platform)) {
      return c.json({ error: "platform must be 'strava'" }, 400);
    }

    const conn = await db
      .select()
      .from(connections)
      .where(
        and(
          eq(connections.userId, userId),
          eq(connections.platform, platform as "strava"),
          eq(connections.status, "active"),
        ),
      )
      .get();

    if (!conn) {
      return c.json({ error: "no active connection for platform" }, 404);
    }

    const syncEnv = {} as unknown as SyncEnv;
    const jobId = crypto.randomUUID();

    if (syncEnv.USER_SYNC_COORDINATOR) {
      const doId = syncEnv.USER_SYNC_COORDINATOR.idFromName(userId);
      const doStub = syncEnv.USER_SYNC_COORDINATOR.get(doId);
      const resp = await doStub.fetch(
        new Request(`https://do/sync?platform=${platform}`, {
          method: "POST",
          body: JSON.stringify({ action: "beginSync", jobId }),
        }),
      );
      const result = (await resp.json()) as
        | { jobId: string }
        | { error: "already_in_flight" };

      if ("error" in result) {
        return c.json({ error: "sync already in flight for this platform" }, 409);
      }
    }

    const msg: SyncJobMessage = {
      userId,
      platform,
      connectionId: conn.id,
      jobId,
      attempt: 0,
    };

    await r.SyncJobs.send(msg);

    log.info(LogEvent.syncJobEnqueued, { userId, platform, jobId, source: "manual_trigger" });

    return c.json({ jobId }, 202);
  });

  return router;
}
