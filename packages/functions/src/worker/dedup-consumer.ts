import { drizzle } from "drizzle-orm/d1";
import { and, eq, gt, lt } from "drizzle-orm";
import { Resource } from "sst";
import {
  activities,
  dedupPending,
  dedupEvaluations,
  withIdempotency,
  createLogger,
  LogEvent,
  scoreDedup,
  mergeActivities,
  type DedupOutcome,
  type DedupReasoning,
} from "@fithub/core";

export interface ActivityIngestedMessage {
  eventId: string;
  userId: string;
  activityId: string;
  correlationId?: string;
}

const DEDUP_WINDOW_MS = 15 * 60 * 1000; // ±15 minutes
const AUTO_MERGE_THRESHOLD = 0.85;
const PENDING_THRESHOLD = 0.70;
const EVAL_THRESHOLD = 0.50; // minimum confidence to persist an evaluation row

type DedupEnv = Record<string, never>;

export default {
  async queue(batch: MessageBatch<ActivityIngestedMessage>, _env: DedupEnv): Promise<void> {
    const r = Resource as unknown as { FithubDb: D1Database; App?: { stage?: string } };
    const stage = (Resource as unknown as { App?: { stage?: string } }).App?.stage ?? "unknown";
    const db = drizzle(r.FithubDb);

    for (const msg of batch.messages) {
      const event = msg.body;
      const correlationId = event.correlationId ?? event.eventId;
      const log = createLogger({ service: "dedup-consumer", env: stage, correlationId });

      await withIdempotency("dedup-consumer", event.eventId, db, async () => {
        // Load the candidate activity
        const [candidate] = await db
          .select()
          .from(activities)
          .where(and(eq(activities.id, event.activityId), eq(activities.userId, event.userId)))
          .limit(1);

        if (!candidate) {
          log.warn(LogEvent.syncJobStarted, { detail: "candidate_not_found", activityId: event.activityId });
          msg.ack();
          return;
        }

        // Find existing activities within ±15-minute window
        const candidateMs = candidate.startedAt instanceof Date ? candidate.startedAt.getTime() : candidate.startedAt;
        const windowStart = new Date(candidateMs - DEDUP_WINDOW_MS);
        const windowEnd = new Date(candidateMs + DEDUP_WINDOW_MS);

        const nearby = await db
          .select()
          .from(activities)
          .where(
            and(
              eq(activities.userId, event.userId),
              gt(activities.startedAt, windowStart),
              lt(activities.startedAt, windowEnd),
            ),
          )
          .all();

        // Exclude the candidate itself
        const candidates = nearby.filter((a) => a.id !== candidate.id);

        let bestScore = 0;
        let bestMatch: typeof candidates[0] | null = null;
        let bestFactors: ReturnType<typeof scoreDedup>["factors"] | null = null;

        for (const existing of candidates) {
          const result = scoreDedup(
            {
              activityType: candidate.activityType,
              startedAt: candidate.startedAt,
              durationSeconds: candidate.durationSeconds,
              distanceMeters: candidate.distanceMeters,
            },
            {
              activityType: existing.activityType,
              startedAt: existing.startedAt,
              durationSeconds: existing.durationSeconds,
              distanceMeters: existing.distanceMeters,
            },
          );

          if (result.confidence > bestScore) {
            bestScore = result.confidence;
            bestMatch = existing;
            bestFactors = result.factors;
          }
        }

        // Determine outcome
        let outcome: DedupOutcome;
        if (!bestMatch || bestScore < PENDING_THRESHOLD) {
          outcome = "no_match";
        } else if (bestScore >= AUTO_MERGE_THRESHOLD) {
          outcome = "merged";
        } else {
          outcome = "pending";
        }

        // Persist evaluation row for all evaluations ≥50% confidence (FR-19)
        if (bestMatch && bestFactors && bestScore >= EVAL_THRESHOLD) {
          const reasoning: DedupReasoning = {
            confidence: bestScore,
            outcome,
            factors: bestFactors,
          };
          await db.insert(dedupEvaluations).values({
            id: crypto.randomUUID(),
            userId: event.userId,
            activityId: candidate.id,
            comparedToId: bestMatch.id,
            confidence: Math.round(bestScore * 100),
            outcome,
            reasoningJson: JSON.stringify(reasoning),
            evaluatedAt: new Date(),
          });
        }

        if (outcome === "no_match") {
          log.info(LogEvent.syncJobStarted, {
            detail: "dedup_no_match",
            activityId: event.activityId,
            bestScore,
          });
          msg.ack();
          return;
        }

        if (outcome === "merged") {
          await mergeActivities(db, bestMatch!.id, candidate.id, bestScore, correlationId);
          log.info(LogEvent.syncJobStarted, {
            detail: "dedup_auto_merged",
            canonicalId: bestMatch!.id,
            duplicateId: candidate.id,
            score: bestScore,
          });
        } else {
          // pending: 70–85% — surface to user for manual resolution
          await db.insert(dedupPending).values({
            id: crypto.randomUUID(),
            userId: event.userId,
            candidateActivityId: candidate.id,
            matchActivityId: bestMatch!.id,
            score: Math.round(bestScore * 100),
            payload: JSON.stringify({ candidateId: candidate.id, matchId: bestMatch!.id, score: bestScore }),
          });
          log.info(LogEvent.syncJobStarted, {
            detail: "dedup_pending_created",
            candidateId: candidate.id,
            matchId: bestMatch!.id,
            score: bestScore,
          });
        }

        msg.ack();
      });
    }
  },
};
