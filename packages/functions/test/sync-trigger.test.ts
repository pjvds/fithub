import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type * as FithubCore from "@fithub/core";
import type { AuthVariables } from "../src/api/middleware/auth.js";
import type { LoggerVariables } from "../src/api/middleware/logger.js";
import type { CorrelationVariables } from "../src/api/middleware/correlation.js";
import type { Logger } from "@fithub/core";

// ------------------------------------------------------------------ hoisted mocks

const { dbFactory, syncJobsMock } = vi.hoisted(() => {
  const makeDb = (connRow: unknown = null) => ({
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue(connRow),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  });

  const dbFactory = {
    current: makeDb(),
    make: makeDb,
  };

  const syncJobsMock = {
    send: vi.fn().mockResolvedValue(undefined),
  };

  return { dbFactory, syncJobsMock };
});

// ------------------------------------------------------------------ module mocks

vi.mock("sst", () => ({
  Resource: {
    FithubDb: {},
    SyncJobs: syncJobsMock,
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
  const { createSyncRouter } = await import("../src/api/routes/sync.js");
  const app = new Hono<AppEnv>();
  app.use("*", (c, next) => {
    c.set("userId", userId);
    c.set("logger", mockLogger);
    c.set("correlationId", "test-correlation");
    return next();
  });
  app.route("/sync", createSyncRouter());
  return app;
}

// ------------------------------------------------------------------ tests

describe("sync trigger router", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  describe("POST /sync/trigger", () => {
    it("returns 404 when no active connection exists", async () => {
      dbFactory.current = dbFactory.make(null); // no conn
      app = await buildApp();

      const res = await app.request("/sync/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "strava" }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 202 with jobId when connection exists", async () => {
      dbFactory.current = dbFactory.make({
        id: "conn-1",
        userId: "user-1",
        platform: "strava",
        status: "active",
        accessTokenCipher: "enc:token",
        refreshTokenCipher: null,
        scopes: null,
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      app = await buildApp();

      const res = await app.request("/sync/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "strava" }),
      });
      expect(res.status).toBe(202);
      const body = await res.json() as { job_id: string };
      expect(typeof body.job_id).toBe("string");
      expect(syncJobsMock.send).toHaveBeenCalledOnce();
    });

    it("returns 400 for invalid platform", async () => {
      const res = await app.request("/sync/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "garmin" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for missing platform", async () => {
      const res = await app.request("/sync/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for malformed JSON body", async () => {
      const res = await app.request("/sync/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      });
      expect(res.status).toBe(400);
    });
  });
});
