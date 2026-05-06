import { drizzle } from "drizzle-orm/d1";
import { and, asc, isNull, lt } from "drizzle-orm";
import { Resource } from "sst";
import { outboxEvents } from "@fithub/core";

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
  };
  const db = drizzle(r.FithubDb);

  const rows = await db
    .select()
    .from(outboxEvents)
    .where(and(isNull(outboxEvents.processedAt), lt(outboxEvents.occurredAt, new Date(Date.now() + 1000))))
    .orderBy(asc(outboxEvents.occurredAt))
    .limit(BATCH_SIZE);

  if (rows.length === 0) return;

  for (const row of rows) {
    try {
      await r.EventBus.send(JSON.parse(row.payload));
    } catch (err) {
      console.error(`outbox-relay: failed to send event ${row.id}`, err);
      continue;
    }
  }

  const ids = rows.map((r) => r.id);
  await r.FithubDb.batch(
    ids.map((id) =>
      r.FithubDb.prepare("UPDATE outbox_events SET processed_at = ? WHERE id = ?").bind(Date.now(), id),
    ),
  );
}
