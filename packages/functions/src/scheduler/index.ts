import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { Resource } from "sst";
import { connections, createLogger, LogEvent } from "@fithub/core";
import { runCleanup } from "../outbox-relay/cleanup.js";

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

  if (isStravaReconcile(cron)) {
    await reconcileStravaConnections(db, log);
  }

  if (isDailyCleanup(cron)) {
    await runCleanup();
  }

  log.info(LogEvent.schedulerTickCompleted, { cron });
}

/** Cron expression: every hour. */
function isStravaReconcile(cron: string): boolean {
  return cron === "0 * * * *";
}

/** Cron expression: daily at midnight UTC. */
function isDailyCleanup(cron: string): boolean {
  return cron === "0 0 * * *";
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
