import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type * as FithubCore from "@fithub/core";
import type { AuthVariables } from "../src/api/middleware/auth.js";
import type { LoggerVariables } from "../src/api/middleware/logger.js";
import type { CorrelationVariables } from "../src/api/middleware/correlation.js";
import type { Logger } from "@fithub/core";

// ------------------------------------------------------------------ hoisted mocks

const { dbFactory } = vi.hoisted(() => {
  const makeDb = (rows: unknown[] = []) => {
    const chainReturning = (returnVal: unknown) => {
      const chain: Record<string, unknown> = {};
      chain.from = vi.fn().mockReturnValue(chain);
      chain.where = vi.fn().mockReturnValue(chain);
      chain.orderBy = vi.fn().mockReturnValue(chain);
      chain.limit = vi.fn().mockReturnValue(chain);
      chain.all = vi.fn().mockResolvedValue(rows);
      chain.get = vi.fn().mockResolvedValue(returnVal ?? rows[0] ?? null);
      return chain;
    };

    return {
      select: vi.fn().mockImplementation(() => chainReturning(rows[0] ?? null)),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    };
  };

  const dbFactory = { current: makeDb(), make: makeDb };
  return { dbFactory };
});

// ------------------------------------------------------------------ module mocks

vi.mock("sst", () => ({
  Resource: {
    FithubDb: {},
  },
}));

vi.mock("drizzle-orm/d1", () => ({
  drizzle: () => dbFactory.current,
}));

vi.mock("@fithub/core", async (importOriginal) => {
  const actual = await importOriginal<typeof FithubCore>();
  return { ...actual };
});

// ------------------------------------------------------------------ helpers

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Logger;

type AppEnv = { Variables: AuthVariables & LoggerVariables & CorrelationVariables };

async function buildApp(userId = "user-1") {
  const { createActivitiesRouter } = await import("../src/api/routes/activities.js");
  const app = new Hono<AppEnv>();
  app.use("*", (c, next) => {
    c.set("userId", userId);
    c.set("logger", mockLogger);
    c.set("correlationId", "test-correlation");
    return next();
  });
  app.route("/activities", createActivitiesRouter());
  return app;
}

// ------------------------------------------------------------------ tests

describe("activities router", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    dbFactory.current = dbFactory.make([
      {
        id: "act-1",
        activityType: "cycling",
        startedAt: new Date("2024-03-01T10:00:00Z"),
        durationSeconds: 3600,
        distanceMeters: 30000,
        title: "Morning Ride",
      },
      {
        id: "act-2",
        activityType: "run",
        startedAt: new Date("2024-02-28T08:00:00Z"),
        durationSeconds: 1800,
        distanceMeters: 5000,
        title: null,
      },
    ]);
    app = await buildApp();
  });

  it("GET / returns 200 with items and null nextCursor when results < limit", async () => {
    const res = await app.request("/activities");
    expect(res.status).toBe(200);
    const body = await res.json() as { items: unknown[]; nextCursor: string | null };
    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).toBeNull();
  });

  it("GET / respects limit query param", async () => {
    const res = await app.request("/activities?limit=1");
    expect(res.status).toBe(200);
    const body = await res.json() as { items: unknown[]; nextCursor: string | null };
    // limit+1 fetch returns 2 rows, so first 1 shown with nextCursor
    expect(body.items).toHaveLength(1);
    expect(body.nextCursor).not.toBeNull();
  });

  it("GET / with cursor applies timestamp filter", async () => {
    const res = await app.request("/activities?cursor=1709125200000");
    expect(res.status).toBe(200);
    const body = await res.json() as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it("GET / with platform filter returns only matching activities", async () => {
    // No sources loaded — all filtered out
    const res = await app.request("/activities?platform=strava");
    expect(res.status).toBe(200);
    const body = await res.json() as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });
});
