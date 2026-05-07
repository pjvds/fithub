import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import { Resource } from "sst";
import {
  activities,
  activitySources,
  appendOutbox,
  connections,
  createLogger,
  decryptToken,
  ErrorCode,
  LogEvent,
  newCloudEvent,
  RateLimitBudget,
} from "@fithub/core";
import type { OAuthPlatformAdapter } from "@fithub/core";

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

type WorkerEnv = {
  USER_SYNC_COORDINATOR: DurableObjectNamespace;
  TokenMasterKey: { value: () => string };
};

export default {
  async queue(
    batch: MessageBatch<SyncJobMessage>,
    env: WorkerEnv,
  ): Promise<void> {
    const r = Resource as unknown as {
      FithubDb: D1Database;
      SyncJobs: Queue<SyncJobMessage>;
      RetryJobs: Queue<SyncJobMessage>;
      BlobStore: R2Bucket;
      FeedCache: KVNamespace;
      TokenMasterKey: { value: () => string };
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
        const doId = env.USER_SYNC_COORDINATOR.idFromName(job.userId);
        const doStub = env.USER_SYNC_COORDINATOR.get(doId);

        const beginResp = await doStub.fetch(
          new Request(
            `https://do/sync?platform=${job.platform}`,
            {
              method: "POST",
              body: JSON.stringify({ action: "beginSync", jobId: job.jobId }),
            },
          ),
        );
        const beginResult = (await beginResp.json()) as
          | { jobId: string }
          | { error: "already_in_flight" };

        if ("error" in beginResult) {
          log.info(LogEvent.syncJobFailed, {
            userId: job.userId,
            platform: job.platform,
            jobId: job.jobId,
            reason: "already_in_flight",
          });
          msg.ack();
          continue;
        }

        const masterKey = r.TokenMasterKey.value();
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
          await doStub.fetch(
            new Request(`https://do/sync?platform=${job.platform}`, {
              method: "POST",
              body: JSON.stringify({ action: "failSync", jobId: job.jobId }),
            }),
          );
          msg.ack();
          continue;
        }

        const accessToken = await decryptToken(connRow.accessTokenCipher, masterKey);

        // Get cursor from DO for incremental sync
        const cursorResp = await doStub.fetch(
          new Request(`https://do/sync?platform=${job.platform}`, {
            method: "POST",
            body: JSON.stringify({ action: "getCursor" }),
          }),
        );
        const { cursor } = (await cursorResp.json()) as { cursor: string | null };
        const since = cursor ? new Date(parseInt(cursor, 10)) : undefined;

        // Resolve adapter from platform type
        const adapter = await resolveAdapter(job.platform, r);
        const budget = new RateLimitBudget();

        if (budget.isExhausted()) {
          log.warn(LogEvent.rateLimitExhausted, { userId: job.userId, platform: job.platform });
          const delayMs = RETRY_DELAYS_MS[Math.min(job.attempt, RETRY_DELAYS_MS.length - 1)]!;
          await r.RetryJobs.send({ ...job, attempt: job.attempt + 1 }, { delaySeconds: Math.floor(delayMs / 1000) });
          msg.ack();
          continue;
        }

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

        await doStub.fetch(
          new Request(`https://do/sync?platform=${job.platform}`, {
            method: "POST",
            body: JSON.stringify({ action: "completeSync", jobId: job.jobId, cursor: newCursor }),
          }),
        );

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
    StravaClientSecret?: { value: () => string };
    [key: string]: unknown;
  },
): Promise<OAuthPlatformAdapter> {
  if (platform === "strava") {
    const { createStravaAdapter } = await import("@fithub/core");
    return createStravaAdapter({
      clientId: "fithub",
      clientSecret: (r.StravaClientSecret as { value: () => string })?.value() ?? "",
    });
  }
  throw new Error(`Unknown platform: ${platform}`);
}
