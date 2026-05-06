import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, lt, desc } from "drizzle-orm";
import { Resource } from "sst";
import { activities, activitySources } from "@fithub/core";
import type { AuthVariables } from "../middleware/auth.js";
import type { LoggerVariables } from "../middleware/logger.js";
import type { CorrelationVariables } from "../middleware/correlation.js";

interface AppEnv {
  Bindings: Record<string, never>;
  Variables: AuthVariables & LoggerVariables & CorrelationVariables;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export function createActivitiesRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  /**
   * GET /api/activities
   * Returns paginated activities for the authenticated user.
   *
   * Query params:
   *   - limit  (default 20, max 100)
   *   - cursor (opaque cursor from previous response; encodes startedAt ms)
   *   - platform (optional filter: zwift | strava)
   */
  router.get("/", async (c) => {
    const userId = c.var.userId;
    const r = Resource as unknown as { FithubDb: D1Database };
    const db = drizzle(r.FithubDb);

    const limitParam = parseInt(c.req.query("limit") ?? String(DEFAULT_PAGE_SIZE), 10);
    const limit = Math.min(isNaN(limitParam) ? DEFAULT_PAGE_SIZE : limitParam, MAX_PAGE_SIZE);
    const cursorParam = c.req.query("cursor");
    const platform = c.req.query("platform");

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
              : (filtered[filtered.length - 1]!.startedAt as number),
          )
        : null;

    return c.json({ items, nextCursor });
  });

  return router;
}
