import type { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import { processedEvents } from "../db/schema.js";

export type Db = ReturnType<typeof drizzle>;

export async function withIdempotency<T>(
  consumerId: string,
  eventId: string,
  db: Db,
  handler: () => Promise<T>,
): Promise<{ status: "processed" | "skipped"; result?: T }> {
  const existing = await db
    .select({ eventId: processedEvents.eventId })
    .from(processedEvents)
    .where(and(eq(processedEvents.consumerId, consumerId), eq(processedEvents.eventId, eventId)))
    .limit(1);

  if (existing.length > 0) {
    return { status: "skipped" };
  }

  const result = await handler();

  await db
    .insert(processedEvents)
    .values({ consumerId, eventId, processedAt: new Date() })
    .onConflictDoNothing();

  return { status: "processed", result };
}
