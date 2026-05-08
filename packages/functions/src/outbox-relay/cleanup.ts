import { drizzle } from "drizzle-orm/d1";
import { lt } from "drizzle-orm";
import { Resource } from "sst";
import { processedEvents, createLogger, LogEvent } from "@fithub/core";

type CleanupEnv = Record<string, never>;

/** 24 hours in milliseconds. Must exceed Queues' 12-hour max retry window. */
const RETENTION_MS = 24 * 60 * 60 * 1000;

export default {
  async scheduled(
    _event: ScheduledEvent,
    _env: CleanupEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(runCleanup());
  },

  async fetch(): Promise<Response> {
    return new Response("cleanup: use scheduled trigger", { status: 200 });
  },
};

export async function runCleanup(): Promise<{ deleted: number }> {
  const r = Resource as unknown as {
    FithubDb: D1Database;
    App?: { stage?: string };
  };
  const stage = (Resource as unknown as { App?: { stage?: string } }).App?.stage ?? "unknown";
  const log = createLogger({
    service: "cleanup",
    env: stage,
    correlationId: crypto.randomUUID(),
  });

  const db = drizzle(r.FithubDb);
  const cutoff = new Date(Date.now() - RETENTION_MS);

  const result = await db
    .delete(processedEvents)
    .where(lt(processedEvents.processedAt, cutoff))
    .run();

  const deleted = result.meta?.changes ?? 0;
  log.info(LogEvent.schedulerTickCompleted, {
    detail: "processed_events_cleanup",
    deleted,
    cutoffIso: cutoff.toISOString(),
  });

  return { deleted };
}
