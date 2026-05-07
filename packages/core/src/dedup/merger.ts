import { eq } from "drizzle-orm";
import { activities, activitySources } from "../db/schema.js";
import { appendOutbox } from "../outbox/publish.js";
import { newCloudEvent } from "../events/types.js";
import type { Db } from "../events/idempotency.js";

export interface MergeResult {
  canonicalActivityId: string;
  mergedSourceId: string;
}

/**
 * Merges `duplicateId` into `canonicalId`:
 * - Re-points all activity_sources from duplicate → canonical
 * - Deletes the duplicate activity row
 * - Emits an `activity.merged` outbox event
 *
 * @param db        Drizzle D1 instance
 * @param canonicalId  The activity that survives
 * @param duplicateId  The activity to absorb and delete
 * @param score     Dedup confidence score (0-1); stored as integer 0-100
 * @param correlationId Optional trace ID forwarded from upstream message
 */
export async function mergeActivities(
  db: Db,
  canonicalId: string,
  duplicateId: string,
  score: number,
  correlationId?: string,
): Promise<MergeResult> {
  // Fetch canonical to get userId
  const [canonical] = await db
    .select({ id: activities.id, userId: activities.userId })
    .from(activities)
    .where(eq(activities.id, canonicalId))
    .limit(1);

  if (!canonical) {
    throw new Error(`canonical activity not found: ${canonicalId}`);
  }

  // Re-point sources from duplicate to canonical
  const movedSources = await db
    .update(activitySources)
    .set({ activityId: canonicalId })
    .where(eq(activitySources.activityId, duplicateId))
    .returning({ id: activitySources.id });

  // Delete the now-orphaned duplicate activity
  await db.delete(activities).where(eq(activities.id, duplicateId));

  // Emit activity.merged cloud event via outbox
  const sourceId = movedSources[0]?.id ?? duplicateId;
  await appendOutbox(
    db,
    newCloudEvent({
      id: crypto.randomUUID(),
      source: "fithub/dedup",
      type: "activity.merged",
      subject: canonicalId,
      ...(correlationId !== undefined ? { correlationId } : {}),
      data: {
        userId: canonical.userId,
        canonicalActivityId: canonicalId,
        newSourceId: sourceId,
        score: Math.round(score * 100),
      },
    }),
  );

  return { canonicalActivityId: canonicalId, mergedSourceId: sourceId };
}
