import { drizzle } from "drizzle-orm/d1";
import { eq, and, isNull } from "drizzle-orm";
import { Resource } from "sst";
import {
  activities,
  activitySources,
  appendOutbox,
  connections,
  syncJobs,
  createLogger,
  maybeRefreshToken,
  ErrorCode,
  LogEvent,
  newCloudEvent,
  RateLimitBudget,
} from "@fithub/core";
import type { OAuthPlatformAdapter } from "@fithub/core";
import { invalidateUserFeedCache } from "../api/routes/activities.js";

/**
 * Retry delay schedule in milliseconds: 5m → 15m → 30m → 1h.
 * Attempts beyond the schedule are capped at the last value.
 */
const RETRY_DELAYS_MS = [
  5 * 60 * 1000,
  15 * 60 * 1000,
  30 * 60 * 1000,
  60 * 60 * 1000,
];

/** Error codes indicating a transient failure (safe to retry). */
const TRANSIENT_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export interface SyncJobMessage {
  userId: string;
  platform: string;
  connectionId: string;
  jobId: string;
  attempt: number;
  correlationId?: string;
}

export default {
  async queue(
    batch: MessageBatch<SyncJobMessage>,
    _env: unknown,
  ): Promise<void> {
    const r = Resource as unknown as {
      FithubDb: D1Database;
      SyncJobs: Queue<SyncJobMessage>;
      RetryJobs: Queue<SyncJobMessage>;
      BlobStore: R2Bucket;
      FeedCache: KVNamespace;
      TOKEN_MASTER_KEY: { value: string };
      STRAVA_CLIENT_ID?: { value: string };
      STRAVA_CLIENT_SECRET?: { value: string };
      App?: { stage?: string };
    };
    const db = drizzle(r.FithubDb);
    const stage = (Resource as unknown as { App?: { stage?: string } }).App?.stage ?? "unknown";

    for (const msg of batch.messages) {
      const job = msg.body;
      const correlationId = job.correlationId ?? job.jobId;
      const log = createLogger({ service: "sync-worker", env: stage, correlationId });

      log.info(LogEvent.syncJobStarted, { userId: job.userId, platform: job.platform, attempt: job.attempt });

      try {
        // Acquire in-flight lock atomically. rowsAffected === 0 means another job holds it.
        const lockResult = await db
          .update(connections)
          .set({ inFlightJobId: job.jobId })
          .where(
            and(
              eq(connections.id, job.connectionId),
              eq(connections.userId, job.userId),
              eq(connections.status, "active"),
              isNull(connections.inFlightJobId),
            ),
          )
          .run();

        if (lockResult.meta.rows_written === 0) {
          log.info(LogEvent.syncJobFailed, {
            userId: job.userId,
            platform: job.platform,
            jobId: job.jobId,
            reason: "already_in_flight",
          });
          // Mark this job (not the in-flight one) as failed so it doesn't stay pending.
          await db
            .update(syncJobs)
            .set({ status: "failed", errorMessage: "Sync already in progress", endedAt: new Date() })
            .where(eq(syncJobs.id, job.jobId))
            .run();
          msg.ack();
          continue;
        }

        const masterKey = r.TOKEN_MASTER_KEY.value;
        const connRow = await db
          .select()
          .from(connections)
          .where(
            and(
              eq(connections.id, job.connectionId),
              eq(connections.userId, job.userId),
              eq(connections.status, "active"),
            ),
          )
          .get();

        if (!connRow) {
          log.error(LogEvent.syncJobFailed, {
            code: ErrorCode.DB_WRITE_FAILED,
            userId: job.userId,
            platform: job.platform,
            jobId: job.jobId,
            reason: "connection_not_found",
          });
          // Release the lock we just acquired
          await db
            .update(connections)
            .set({ inFlightJobId: null })
            .where(eq(connections.id, job.connectionId))
            .run();
          msg.ack();
          continue;
        }

        // Read cursor from connection row for incremental sync
        const cursor = connRow.syncCursor ?? null;
        const since = cursor ? new Date(parseInt(cursor, 10)) : undefined;

        // Resolve adapter from platform type (needed before token refresh)
        const adapter = await resolveAdapter(job.platform, r);
        const budget = new RateLimitBudget();

        if (budget.isExhausted()) {
          log.warn(LogEvent.rateLimitExhausted, { userId: job.userId, platform: job.platform });
          const delayMs = RETRY_DELAYS_MS[Math.min(job.attempt, RETRY_DELAYS_MS.length - 1)]!;
          await r.RetryJobs.send({ ...job, attempt: job.attempt + 1 }, { delaySeconds: Math.floor(delayMs / 1000) });
          msg.ack();
          continue;
        }

        // Refresh token if near expiry before fetching activities
        const accessToken = await maybeRefreshToken(db, job.connectionId, adapter, masterKey, log);

        budget.decrement();
        const rawActivities = await adapter.fetchActivities(accessToken, since);

        let newActivities = 0;
        let newCursor: string | null = null;

        for (const raw of rawActivities) {
          const activityId = crypto.randomUUID();
          const sourceId = crypto.randomUUID();
          const now = Date.now();

          // Store raw blob in R2
          const blobPath = `raw/${job.userId}/${job.platform}/${raw.externalId}.json`;
          await r.BlobStore.put(blobPath, JSON.stringify(raw.rawJson), {
            httpMetadata: { contentType: "application/json" },
          });

          // Upsert canonical activity
          const existing = await db
            .select()
            .from(activitySources)
            .where(
              and(
                eq(activitySources.platform, job.platform),
                eq(activitySources.externalId, raw.externalId),
              ),
            )
            .get();

          if (existing) continue;

          const parsed = parseActivity(raw, job.userId, activityId);
          await db.insert(activities).values(parsed).onConflictDoNothing();
          await db.insert(activitySources).values({
            id: sourceId,
            activityId,
            userId: job.userId,
            platform: job.platform,
            externalId: raw.externalId,
            rawPath: blobPath,
            createdAt: new Date(now),
          });

          await appendOutbox(db, newCloudEvent({
            id: crypto.randomUUID(),
            source: `fithub/${job.platform}`,
            type: "activity.ingested",
            subject: activityId,
            data: {
              userId: job.userId,
              platform: job.platform,
              externalId: raw.externalId,
              rawPath: blobPath,
              ingestedAt: new Date(now).toISOString(),
            },
          }));

          log.info(LogEvent.activityIngested, {
            userId: job.userId,
            platform: job.platform,
            externalId: raw.externalId,
          });

          newActivities++;
          newCursor = String(now);
        }

        // Advance cursor to current time if we had any results
        if (rawActivities.length > 0 && newCursor === null) {
          newCursor = String(Date.now());
        }

        // Invalidate KV feed cache for this user when new activities were ingested.
        if (newActivities > 0) {
          void invalidateUserFeedCache(r.FeedCache, job.userId);
        }

        // Release lock and advance cursor
        await db
          .update(connections)
          .set({ inFlightJobId: null, ...(newCursor !== null ? { syncCursor: newCursor } : {}) })
          .where(eq(connections.id, job.connectionId))
          .run();

        // Mark job as succeeded in the DB
        await db
          .update(syncJobs)
          .set({ status: "success", activitiesSynced: newActivities, endedAt: new Date() })
          .where(eq(syncJobs.id, job.jobId))
          .run();

        log.info(LogEvent.syncJobCompleted, {
          userId: job.userId,
          platform: job.platform,
          jobId: job.jobId,
          newActivities,
        });

        msg.ack();
      } catch (err) {
        const isTransient =
          err instanceof TransientSyncError || isTransientError(err);

        log.error(LogEvent.syncJobFailed, {
          code: isTransient ? ErrorCode.EXTERNAL_5XX : ErrorCode.DB_WRITE_FAILED,
          userId: job.userId,
          platform: job.platform,
          jobId: job.jobId,
          attempt: job.attempt,
          err,
        });

        // Release the in-flight lock on failure. Wrapped in try/catch so that
        // a failure here (e.g. missing column) does not prevent the job from
        // being marked failed and the message from being acked.
        try {
          await db
            .update(connections)
            .set({ inFlightJobId: null })
            .where(eq(connections.id, job.connectionId))
            .run();
        } catch (lockErr) {
          log.error(LogEvent.syncJobFailed, {
            code: ErrorCode.DB_WRITE_FAILED,
            jobId: job.jobId,
            reason: "lock_release_failed",
            err: lockErr,
          });
        }

        // Only mark as permanently failed if we won't retry
        if (!isTransient || job.attempt >= RETRY_DELAYS_MS.length) {
          await db
            .update(syncJobs)
            .set({
              status: "failed",
              errorMessage: err instanceof Error ? err.message : String(err),
              endedAt: new Date(),
            })
            .where(eq(syncJobs.id, job.jobId))
            .run();
        }

        if (isTransient && job.attempt < RETRY_DELAYS_MS.length) {
          const delayMs = RETRY_DELAYS_MS[job.attempt]!;
          const r2 = Resource as unknown as { RetryJobs: Queue<SyncJobMessage> };
          await r2.RetryJobs.send(
            { ...job, attempt: job.attempt + 1 },
            { delaySeconds: Math.floor(delayMs / 1000) },
          );
        }

        msg.ack();
      }
    }
  },

  async fetch(): Promise<Response> {
    return new Response("sync-worker: use queue consumer", { status: 200 });
  },
};

class TransientSyncError extends Error {}

function isTransientError(err: unknown): boolean {
  if (err instanceof Error && "status" in err) {
    return TRANSIENT_HTTP_STATUSES.has((err as { status: number }).status);
  }
  return false;
}

function parseActivity(
  raw: { externalId: string; rawJson: unknown },
  userId: string,
  activityId: string,
) {
  const data = raw.rawJson as Record<string, unknown>;
  return {
    id: activityId,
    userId,
    activityType: String(data["sport_type"] ?? data["type"] ?? "workout"),
    startedAt: new Date(String(data["start_date"] ?? data["startTime"] ?? Date.now())),
    durationSeconds: typeof data["elapsed_time"] === "number" ? data["elapsed_time"] : null,
    distanceMeters: typeof data["distance"] === "number" ? Math.round(data["distance"]) : null,
    title: typeof data["name"] === "string" ? data["name"] : null,
    canonicalJson: JSON.stringify(data),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function resolveAdapter(
  platform: string,
  r: {
    STRAVA_CLIENT_ID?: { value: string };
    STRAVA_CLIENT_SECRET?: { value: string };
    [key: string]: unknown;
  },
): Promise<OAuthPlatformAdapter> {
  if (platform === "strava") {
    const { createStravaAdapter } = await import("@fithub/core");
    return createStravaAdapter({
      clientId: r.STRAVA_CLIENT_ID?.value ?? "",
      clientSecret: r.STRAVA_CLIENT_SECRET?.value ?? "",
    });
  }
  throw new Error(`Unknown platform: ${platform}`);
}
