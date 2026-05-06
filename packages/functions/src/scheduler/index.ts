import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { Resource } from "sst";
import { connections, createLogger, LogEvent } from "@fithub/core";
import type { SyncJobMessage } from "../worker/index.js";

type SchedulerEnv = Record<string, never>;

export default {
  async scheduled(
    event: ScheduledEvent,
    _env: SchedulerEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(runSchedulerTick(event.cron));
  },

  async fetch(): Promise<Response> {
    return new Response("scheduler: use scheduled trigger", { status: 200 });
  },
};

async function runSchedulerTick(cron: string): Promise<void> {
  const r = Resource as unknown as {
    FithubDb: D1Database;
    SyncJobs: Queue<SyncJobMessage>;
    App?: { stage?: string };
  };
  const stage = (Resource as unknown as { App?: { stage?: string } }).App?.stage ?? "unknown";
  const correlationId = crypto.randomUUID();
  const log = createLogger({
    service: "scheduler",
    env: stage,
    correlationId,
  });

  log.info(LogEvent.schedulerTickStarted, { cron });

  const db = drizzle(r.FithubDb);

  if (isZwiftPoll(cron)) {
    await enqueueZwiftSyncs(db, r.SyncJobs, log, correlationId);
  } else if (isStravaReconcile(cron)) {
    await reconcileStravaConnections(db, log);
  }

  log.info(LogEvent.schedulerTickCompleted, { cron });
}

/** Cron expression: every 30 minutes. */
function isZwiftPoll(cron: string): boolean {
  return cron === "*/30 * * * *";
}

/** Cron expression: every hour. */
function isStravaReconcile(cron: string): boolean {
  return cron === "0 * * * *";
}

async function enqueueZwiftSyncs(
  db: ReturnType<typeof drizzle>,
  queue: Queue<SyncJobMessage>,
  log: ReturnType<typeof createLogger>,
  correlationId: string,
): Promise<void> {
  const activeZwift = await db
    .select()
    .from(connections)
    .where(eq(connections.platform, "zwift"))
    .all();

  const active = activeZwift.filter((c) => c.status === "active");

  for (const conn of active) {
    const jobId = crypto.randomUUID();
    const msg: SyncJobMessage = {
      userId: conn.userId,
      platform: "zwift",
      connectionId: conn.id,
      jobId,
      attempt: 0,
      correlationId,
    };

    await queue.send(msg);
    log.info(LogEvent.syncJobEnqueued, {
      userId: conn.userId,
      platform: "zwift",
      jobId,
    });
  }
}

/**
 * Strava reconcile: verify active connections are still valid and degrade
 * any that return 401 from the Strava API.  In practice this is a no-op
 * placeholder — full reconcile logic requires token refresh, which is
 * handled by the token-refresh module during actual sync jobs.
 */
async function reconcileStravaConnections(
  db: ReturnType<typeof drizzle>,
  log: ReturnType<typeof createLogger>,
): Promise<void> {
  const stravaConns = await db
    .select()
    .from(connections)
    .where(eq(connections.platform, "strava"))
    .all();

  log.info(LogEvent.schedulerTickCompleted, {
    detail: "strava_reconcile",
    total: stravaConns.length,
    active: stravaConns.filter((c) => c.status === "active").length,
  });
}
