import type { Db } from "../events/idempotency.js";
import { auditLog } from "../db/schema.js";

export interface AuditEntry {
  userId?: string | null;
  eventType: string;
  platform?: string | null;
  metadata?: Record<string, unknown>;
}

export async function logAuditEvent(db: Db, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    id: crypto.randomUUID(),
    userId: entry.userId ?? null,
    eventType: entry.eventType,
    platform: entry.platform ?? null,
    metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
  });
}
