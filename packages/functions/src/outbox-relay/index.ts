import { drizzle } from "drizzle-orm/d1";
import { and, asc, isNull, lt } from "drizzle-orm";
import { Resource } from "sst";
import { createLogger, ErrorCode, LogEvent, outboxEvents } from "@fithub/core";

const BATCH_SIZE = 100;

export default {
  async scheduled(_event: ScheduledEvent, _env: unknown, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(drainOutbox());
  },

  async fetch(): Promise<Response> {
    return new Response("outbox-relay: use scheduled trigger", { status: 200 });
  },
};

async function drainOutbox(): Promise<void> {
  const r = Resource as unknown as {
    FithubDb: D1Database;
    EventBus: { send: (msg: unknown) => Promise<void> };
    App?: { stage?: string };
  };
  const stage = (Resource as unknown as { App?: { stage?: string } }).App?.stage ?? "unknown";
  const log = createLogger({
    service: "outbox-relay",
    env: stage,
    correlationId: crypto.randomUUID(),
  });
  const db = drizzle(r.FithubDb);

  log.info(LogEvent.outboxRelayTickStarted);

  const rows = await db
    .select()
    .from(outboxEvents)
    .where(and(isNull(outboxEvents.processedAt), lt(outboxEvents.occurredAt, new Date(Date.now() + 1000))))
    .orderBy(asc(outboxEvents.occurredAt))
    .limit(BATCH_SIZE);

  if (rows.length === 0) {
    log.info(LogEvent.outboxRelayTickCompleted, { processed: 0 });
    return;
  }

  let succeeded = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await r.EventBus.send(JSON.parse(row.payload));
      succeeded++;
    } catch (err) {
      failed++;
      log.error(LogEvent.outboxRelayPublishFailed, {
        code: ErrorCode.QUEUE_PUBLISH_FAILED,
        err,
        eventId: row.id,
      });
      continue;
    }
  }

  const ids = rows.map((r) => r.id);
  await r.FithubDb.batch(
    ids.map((id) =>
      r.FithubDb.prepare("UPDATE outbox_events SET processed_at = ? WHERE id = ?").bind(Date.now(), id),
    ),
  );

  log.info(LogEvent.outboxRelayTickCompleted, { processed: rows.length, succeeded, failed });
}
