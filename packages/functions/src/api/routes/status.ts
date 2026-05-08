import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";
import { Resource } from "sst";
import { connections } from "@fithub/core";

interface AppEnv {
  Bindings: Record<string, never>;
  Variables: Record<string, never>;
}

export function createStatusRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  /**
   * GET /api/status
   * Public endpoint — no auth required.
   * Returns platform sync health indicators for the status page.
   * Constitution §7 compliance.
   */
  router.get("/", async (c) => {
    const r = Resource as unknown as { FithubDb: D1Database };
    const db = drizzle(r.FithubDb);

    // Per-platform connection health breakdown.
    const stats = await db
      .select({
        platform: connections.platform,
        status: connections.status,
        count: sql<number>`count(*)`,
      })
      .from(connections)
      .groupBy(connections.platform, connections.status)
      .all();

    // Aggregate into a platform → { active, degraded, revoked } map.
    const platformMap: Record<string, { active: number; degraded: number; revoked: number }> = {};
    for (const row of stats) {
      if (!platformMap[row.platform]) {
        platformMap[row.platform] = { active: 0, degraded: 0, revoked: 0 };
      }
      if (row.status === "active") platformMap[row.platform]!.active = row.count;
      else if (row.status === "degraded") platformMap[row.platform]!.degraded = row.count;
      else if (row.status === "revoked") platformMap[row.platform]!.revoked = row.count;
    }

    const platforms = Object.entries(platformMap).map(([platform, counts]) => {
      const total = counts.active + counts.degraded + counts.revoked;
      const healthPct = total === 0 ? 100 : Math.round((counts.active / total) * 100);
      return {
        platform,
        connections: {
          active: counts.active,
          degraded: counts.degraded,
          revoked: counts.revoked,
          total,
        },
        healthPercent: healthPct,
        status: healthPct === 100 ? "healthy" : healthPct >= 90 ? "degraded" : "unhealthy",
      };
    });

    const overallHealthy = platforms.every((p) => p.status === "healthy");
    const anyUnhealthy = platforms.some((p) => p.status === "unhealthy");

    return c.json({
      status: overallHealthy ? "healthy" : anyUnhealthy ? "unhealthy" : "degraded",
      ts: new Date().toISOString(),
      platforms,
    });
  });

  return router;
}
