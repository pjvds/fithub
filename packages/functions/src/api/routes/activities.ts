import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, lt, desc } from "drizzle-orm";
import { Resource } from "sst";
import { activities, activitySources, dedupEvaluations, type DedupReasoning } from "@fithub/core";
import type { AuthVariables } from "../middleware/auth.js";
import type { LoggerVariables } from "../middleware/logger.js";
import type { CorrelationVariables } from "../middleware/correlation.js";

interface AppEnv {
  Bindings: {
    FeedCache: KVNamespace;
  };
  Variables: AuthVariables & LoggerVariables & CorrelationVariables;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
/** 5-minute KV TTL for hot activity feed pages. */
const FEED_CACHE_TTL_SECONDS = 300;

/** Build a deterministic KV key for a given set of query params. */
function feedCacheKey(userId: string, cursor: string | undefined, limit: number, platform: string | undefined): string {
  return `feed:v1:${userId}:${cursor ?? ""}:${limit}:${platform ?? ""}`;
}

/** Delete all feed cache entries for a user (called on new activity ingest). */
export async function invalidateUserFeedCache(kv: KVNamespace, userId: string): Promise<void> {
  const prefix = `feed:v1:${userId}:`;
  let cursor: string | null = null;
  do {
    const page: KVNamespaceListResult<unknown, string> = await kv.list({ prefix, ...(cursor ? { cursor } : {}), limit: 100 });
    await Promise.all(page.keys.map((k: KVNamespaceListKey<unknown, string>) => kv.delete(k.name)));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor !== null);
}

export function createActivitiesRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  /**
   * GET /api/activities
   * Returns paginated activities for the authenticated user.
   *
   * Query params:
   *   - limit  (default 20, max 100)
   *   - cursor (opaque cursor from previous response; encodes startedAt ms)
   *   - platform (optional filter: strava)
   */
  router.get("/", async (c) => {
    const userId = c.var.userId;
    const r = Resource as unknown as { FithubDb: D1Database };
    const db = drizzle(r.FithubDb);

    const limitParam = parseInt(c.req.query("limit") ?? String(DEFAULT_PAGE_SIZE), 10);
    const limit = Math.min(isNaN(limitParam) ? DEFAULT_PAGE_SIZE : limitParam, MAX_PAGE_SIZE);
    const cursorParam = c.req.query("cursor");
    const platform = c.req.query("platform");

    // Check KV feed cache first.
    const cacheKey = feedCacheKey(userId, cursorParam, limit, platform);
    const kv = c.env?.FeedCache;
    if (kv) {
      const cached = await kv.get(cacheKey, "text");
      if (cached) {
        return c.json(JSON.parse(cached), 200, { "X-Cache": "HIT" });
      }
    }

    const cursorDate = cursorParam
      ? new Date(parseInt(cursorParam, 10))
      : undefined;

    const rows = await db
      .select({
        id: activities.id,
        activityType: activities.activityType,
        startedAt: activities.startedAt,
        durationSeconds: activities.durationSeconds,
        distanceMeters: activities.distanceMeters,
        title: activities.title,
      })
      .from(activities)
      .where(
        and(
          eq(activities.userId, userId),
          cursorDate ? lt(activities.startedAt, cursorDate) : undefined,
        ),
      )
      .orderBy(desc(activities.startedAt))
      .limit(limit + 1)
      .all();

    let sources: Array<{ activityId: string; platform: string; externalId: string }> = [];
    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
      const allSources = await db
        .select({
          activityId: activitySources.activityId,
          platform: activitySources.platform,
          externalId: activitySources.externalId,
        })
        .from(activitySources)
        .where(eq(activitySources.userId, userId))
        .all();
      sources = allSources.filter((s) => ids.includes(s.activityId));
    }

    const sourcesByActivity = new Map<string, { platform: string; externalId: string }[]>();
    for (const s of sources) {
      const existing = sourcesByActivity.get(s.activityId) ?? [];
      existing.push({ platform: s.platform, externalId: s.externalId });
      sourcesByActivity.set(s.activityId, existing);
    }

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);

    const filtered = platform
      ? page.filter((row) =>
          (sourcesByActivity.get(row.id) ?? []).some((s) => s.platform === platform),
        )
      : page;

    const items = filtered.map((row) => ({
      id: row.id,
      activityType: row.activityType,
      startedAt: row.startedAt instanceof Date
        ? row.startedAt.toISOString()
        : new Date(row.startedAt as number).toISOString(),
      durationSeconds: row.durationSeconds,
      distanceMeters: row.distanceMeters,
      title: row.title,
      sources: sourcesByActivity.get(row.id) ?? [],
    }));

    const nextCursor =
      hasMore && filtered.length > 0
        ? String(
            filtered[filtered.length - 1]!.startedAt instanceof Date
              ? (filtered[filtered.length - 1]!.startedAt as Date).getTime()
              : (filtered[filtered.length - 1]!.startedAt as unknown as number),
          )
        : null;

    const body = { items, nextCursor };

    // Populate KV cache for this page (best-effort, fire-and-forget).
    if (kv) {
      void kv.put(cacheKey, JSON.stringify(body), { expirationTtl: FEED_CACHE_TTL_SECONDS });
    }

    return c.json(body);
  });

  /**
   * GET /api/activities/:id/dedup
   * Returns all dedup evaluations for a specific activity (FR-20).
   * Explains why the activity was or was not flagged as a duplicate.
   *
   * - 404 if activity doesn't exist or belongs to another user
   * - evaluations: [] with summary if no candidates were found within the window
   */
  router.get("/:id/dedup", async (c) => {
    const userId = c.var.userId;
    const activityId = c.req.param("id");
    const r = Resource as unknown as { FithubDb: D1Database };
    const db = drizzle(r.FithubDb);

    // Verify the activity exists and belongs to this user
    const [activity] = await db
      .select({ id: activities.id })
      .from(activities)
      .where(and(eq(activities.id, activityId), eq(activities.userId, userId)))
      .limit(1);

    if (!activity) {
      return c.json({ error: "not found" }, 404);
    }

    const evalRows = await db
      .select()
      .from(dedupEvaluations)
      .where(
        and(
          eq(dedupEvaluations.activityId, activityId),
          eq(dedupEvaluations.userId, userId),
        ),
      )
      .orderBy(desc(dedupEvaluations.evaluatedAt))
      .all();

    if (evalRows.length === 0) {
      return c.json({
        evaluations: [],
        summary: "No activities were found within the ±15-minute window when this activity was ingested",
      });
    }

    const evaluations = evalRows.map((row) => {
      let reasoning: DedupReasoning | null = null;
      try {
        reasoning = JSON.parse(row.reasoningJson) as DedupReasoning;
      } catch {
        // malformed JSON — return null reasoning
      }
      return {
        id: row.id,
        comparedToId: row.comparedToId,
        confidence: row.confidence,
        outcome: row.outcome,
        reasoning,
        evaluatedAt: row.evaluatedAt instanceof Date ? row.evaluatedAt.toISOString() : new Date(row.evaluatedAt as unknown as number).toISOString(),
      };
    });

    return c.json({ evaluations });
  });

  return router;
}
