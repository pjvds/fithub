import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, desc } from "drizzle-orm";
import { Resource } from "sst";
import { connections, syncJobs, createLogger, LogEvent } from "@fithub/core";
import type { AuthVariables } from "../middleware/auth.js";
import type { LoggerVariables } from "../middleware/logger.js";
import type { CorrelationVariables } from "../middleware/correlation.js";
import type { SyncJobMessage } from "../../worker/index.js";
import type { SyncHistoryResponse, ManualSyncResponse } from "@fithub/core";

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
   * GET /api/sync/history
   * Returns paginated sync job history for the authenticated user.
   */
  router.get("/history", async (c) => {
    const userId = c.var.userId;
    const r = Resource as unknown as { FithubDb: D1Database };
    const db = drizzle(r.FithubDb);

    const limitParam = Number(c.req.query("limit") ?? "20");
    const limit = Math.min(Math.max(1, limitParam), 100);

    const rows = await db
      .select()
      .from(syncJobs)
      .where(eq(syncJobs.userId, userId))
      .orderBy(desc(syncJobs.startedAt))
      .limit(limit)
      .all();

    const response: SyncHistoryResponse = {
      jobs: rows.map((row) => ({
        id: row.id,
        platform: row.platform,
        status: row.status,
        started_at: Math.floor(row.startedAt.getTime() / 1000),
        ended_at: row.endedAt ? Math.floor(row.endedAt.getTime() / 1000) : null,
        activities_synced: row.activitiesSynced,
        error_message: row.errorMessage,
      })),
      next_cursor: null,
    };
    return c.json(response);
  });

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

    // Persist the job so it appears in sync history
    const now = new Date();
    await db.insert(syncJobs).values({
      id: jobId,
      userId,
      connectionId: conn.id,
      platform: platform as "strava",
      status: "pending",
      source: "manual",
      activitiesSynced: 0,
      startedAt: now,
    });

    log.info(LogEvent.syncJobEnqueued, { userId, platform, jobId, source: "manual_trigger" });

    const response: ManualSyncResponse = {
      job_id: jobId,
      platform: platform as "strava",
      status: "pending",
      started_at: Math.floor(now.getTime() / 1000),
    };
    return c.json(response, 202);
  });

  return router;
}
