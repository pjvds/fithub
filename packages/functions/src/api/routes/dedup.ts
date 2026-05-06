import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import { Resource } from "sst";
import { z } from "zod";
import { activities, dedupPending, dedupEvaluations, mergeActivities, type DedupReasoning } from "@fithub/core";
import type { AuthVariables } from "../middleware/auth.js";
import type { LoggerVariables } from "../middleware/logger.js";
import type { CorrelationVariables } from "../middleware/correlation.js";

interface AppEnv {
  Bindings: Record<string, never>;
  Variables: AuthVariables & LoggerVariables & CorrelationVariables;
}

const ResolveBody = z.object({
  decision: z.enum(["merge", "separate"]),
});

export function createDedupRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  /**
   * GET /api/dedup/pending
   * Returns pending deduplication decisions for the authenticated user.
   * Each item includes candidate and match activity summaries plus dedup reasoning (FR-18).
   */
  router.get("/pending", async (c) => {
    const userId = c.var.userId;
    const r = Resource as unknown as { FithubDb: D1Database };
    const db = drizzle(r.FithubDb);

    const pending = await db
      .select()
      .from(dedupPending)
      .where(eq(dedupPending.userId, userId))
      .all();

    if (pending.length === 0) {
      return c.json({ items: [] });
    }

    // Gather all activity IDs needed
    const activityIds = new Set<string>();
    for (const p of pending) {
      activityIds.add(p.candidateActivityId);
      activityIds.add(p.matchActivityId);
    }

    const activityRows = await db
      .select({
        id: activities.id,
        activityType: activities.activityType,
        startedAt: activities.startedAt,
        durationSeconds: activities.durationSeconds,
        distanceMeters: activities.distanceMeters,
        title: activities.title,
      })
      .from(activities)
      .where(eq(activities.userId, userId))
      .all();

    const activityMap = new Map(activityRows.map((a) => [a.id, a]));

    // Fetch reasoning for all pending items in one query.
    // Join key: activityId = candidateActivityId AND comparedToId = matchActivityId AND outcome = 'pending'
    const evalRows = await db
      .select({
        activityId: dedupEvaluations.activityId,
        comparedToId: dedupEvaluations.comparedToId,
        reasoningJson: dedupEvaluations.reasoningJson,
      })
      .from(dedupEvaluations)
      .where(
        and(
          eq(dedupEvaluations.userId, userId),
          eq(dedupEvaluations.outcome, "pending"),
        ),
      )
      .all();

    // Build lookup map keyed by `${candidateId}:${matchId}`
    const reasoningMap = new Map<string, DedupReasoning>();
    for (const row of evalRows) {
      if (row.comparedToId) {
        const key = `${row.activityId}:${row.comparedToId}`;
        try {
          reasoningMap.set(key, JSON.parse(row.reasoningJson) as DedupReasoning);
        } catch {
          // malformed JSON — skip
        }
      }
    }

    const items = pending.map((p) => {
      const candidate = activityMap.get(p.candidateActivityId);
      const match = activityMap.get(p.matchActivityId);
      const reasoning = reasoningMap.get(`${p.candidateActivityId}:${p.matchActivityId}`) ?? null;
      return {
        id: p.id,
        score: p.score,
        createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : new Date(p.createdAt as number).toISOString(),
        reasoning,
        candidate: candidate
          ? {
              id: candidate.id,
              activityType: candidate.activityType,
              startedAt: candidate.startedAt instanceof Date
                ? candidate.startedAt.toISOString()
                : new Date(candidate.startedAt as number).toISOString(),
              durationSeconds: candidate.durationSeconds,
              distanceMeters: candidate.distanceMeters,
              title: candidate.title,
            }
          : null,
        match: match
          ? {
              id: match.id,
              activityType: match.activityType,
              startedAt: match.startedAt instanceof Date
                ? match.startedAt.toISOString()
                : new Date(match.startedAt as number).toISOString(),
              durationSeconds: match.durationSeconds,
              distanceMeters: match.distanceMeters,
              title: match.title,
            }
          : null,
      };
    });

    return c.json({ items });
  });

  /**
   * POST /api/dedup/:id/resolve
   * Resolves a pending dedup item.
   * Body: { decision: "merge" | "separate" }
   * - merge: calls merger to absorb candidate into match, then deletes dedup_pending row
   * - separate: deletes dedup_pending row without merging
   */
  router.post("/:id/resolve", async (c) => {
    const userId = c.var.userId;
    const pendingId = c.req.param("id");
    const r = Resource as unknown as { FithubDb: D1Database };
    const db = drizzle(r.FithubDb);

    let body: { decision: "merge" | "separate" };
    try {
      const raw = await c.req.json();
      body = ResolveBody.parse(raw);
    } catch {
      return c.json({ error: "invalid request body" }, 400);
    }

    const [pending] = await db
      .select()
      .from(dedupPending)
      .where(and(eq(dedupPending.id, pendingId), eq(dedupPending.userId, userId)))
      .limit(1);

    if (!pending) {
      return c.json({ error: "not found" }, 404);
    }

    if (body.decision === "merge") {
      await mergeActivities(
        db,
        pending.matchActivityId,
        pending.candidateActivityId,
        pending.score / 100,
        c.var.correlationId,
      );
    }

    await db.delete(dedupPending).where(eq(dedupPending.id, pendingId));

    return c.json({ ok: true, decision: body.decision });
  });

  return router;
}
