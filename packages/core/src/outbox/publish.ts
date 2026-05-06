import type { CloudEvent } from "../events/types.js";
import type { Db } from "../events/idempotency.js";
import { outboxEvents } from "../db/schema.js";

export interface OutboxRow {
  id: string;
  eventType: string;
  source: string;
  subject: string | null;
  payload: string;
  occurredAt: Date;
}

export function eventToOutboxRow<T>(event: CloudEvent<T>): OutboxRow {
  return {
    id: event.id,
    eventType: event.type,
    source: event.source,
    subject: event.subject ?? null,
    payload: JSON.stringify(event),
    occurredAt: new Date(event.time),
  };
}

export async function appendOutbox<T>(db: Db, event: CloudEvent<T>): Promise<void> {
  const row = eventToOutboxRow(event);
  await db.insert(outboxEvents).values({
    id: row.id,
    eventType: row.eventType,
    source: row.source,
    subject: row.subject,
    payload: row.payload,
    occurredAt: row.occurredAt,
  });
}
