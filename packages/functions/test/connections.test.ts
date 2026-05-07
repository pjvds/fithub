import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AuthVariables } from "../src/api/middleware/auth.js";
import type { LoggerVariables } from "../src/api/middleware/logger.js";
import type { CorrelationVariables } from "../src/api/middleware/correlation.js";
import type { Logger } from "@fithub/core";

// ------------------------------------------------------------------ hoisted mocks

const { kvMock, dbFactory, stravaMock } = vi.hoisted(() => {
  const kvMock = {
    get: vi.fn(),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };

  /** Create a fresh DB mock where `.where()` resolves to `rows`. */
  const makeDb = (rows: unknown[] = []) => {
    const selectRows = Promise.resolve(rows) as Promise<unknown[]> & { limit: ReturnType<typeof vi.fn> };
    selectRows.limit = vi.fn().mockResolvedValue(rows);

    return {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue(selectRows),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    };
  };

  // Factory that always returns the latest db for the current test.
  const dbFactory = { current: makeDb(), make: makeDb };

  const stravaMock = {
    platform: "strava",
    buildAuthUrl: vi.fn().mockReturnValue("https://strava.example.com/oauth/authorize?state=x"),
    exchangeCode: vi.fn().mockResolvedValue({
      accessToken: "strava-access",
      refreshToken: "strava-refresh",
      expiresAt: new Date(Date.now() + 3600_000),
      scopes: "read,activity:read_all",
      platformUserId: "s-123",
    }),
    fetchActivities: vi.fn(),
    refreshToken: vi.fn(),
    validateToken: vi.fn(),
    revokeToken: vi.fn().mockResolvedValue(undefined),
  };

  return { kvMock, dbFactory, stravaMock };
});

// ------------------------------------------------------------------ module mocks

vi.mock("sst", () => ({
  Resource: {
    FithubDb: {},
    AuthKv: kvMock,
    TOKEN_MASTER_KEY: { value: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" },
    STRAVA_CLIENT_ID: { value: "strava-id" },
    STRAVA_CLIENT_SECRET: { value: "strava-secret" },
    REDIRECT_BASE_URL: { value: "https://example.com" },
  },
}));

vi.mock("drizzle-orm/d1", () => ({
  drizzle: () => dbFactory.current,
}));

vi.mock("@fithub/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@fithub/core")>();
  return {
    ...actual,
    createStravaAdapter: () => stravaMock,
    encryptToken: vi.fn().mockImplementation(async (token: string) => `enc:${token}`),
    decryptToken: vi.fn().mockImplementation(async (cipher: string) => cipher.replace(/^enc:/, "")),
  };
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
  // Import AFTER mocks are set up (dynamic import to allow mock hoisting to settle)
  const { connectionsRouter } = await import("../src/api/routes/connections.js");

  const app = new Hono<AppEnv>();
  app.use("*", (c, next) => {
    c.set("userId", userId);
    c.set("logger", mockLogger);
    c.set("correlationId", "test-correlation-id");
    return next();
  });
  app.route("/connections", connectionsRouter);
  return app;
}

// ------------------------------------------------------------------ tests

describe("connections router", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    dbFactory.current = dbFactory.make();
    app = await buildApp();
  });

  // ---------------------------------------------------------------- POST /initiate

  describe("POST /:platform/oauth/initiate", () => {
    it("returns 400 for an unsupported platform", async () => {
      const res = await app.request("/connections/garmin/oauth/initiate", { method: "POST" });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("platform_not_supported");
    });

    it("stores PKCE state in KV with TTL", async () => {
      await app.request("/connections/strava/oauth/initiate", { method: "POST" });

      expect(kvMock.put).toHaveBeenCalledTimes(1);
      const [key, _value, opts] = kvMock.put.mock.calls[0]! as [string, string, { expirationTtl: number }];
      expect(key).toMatch(/^oauth_state:/);
      expect(opts.expirationTtl).toBe(300);
    });

    it("returns authUrl for strava", async () => {
      const res = await app.request("/connections/strava/oauth/initiate", { method: "POST" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { authUrl: string };
      expect(body.authUrl).toContain("strava.example.com");
    });
  });

  // ---------------------------------------------------------------- POST /callback

  describe("POST /:platform/oauth/callback", () => {
    it("returns 400 for unsupported platform", async () => {
      const res = await app.request("/connections/garmin/oauth/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "c", state: "s" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when state is missing from body", async () => {
      kvMock.get.mockResolvedValue(null);
      const res = await app.request("/connections/strava/oauth/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "auth-code" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when state is not found in KV (expired or invalid)", async () => {
      kvMock.get.mockResolvedValue(null);
      const res = await app.request("/connections/strava/oauth/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "auth-code", state: "expired-state" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("invalid_or_expired_state");
    });

    it("returns 201 and connectionId on successful callback", async () => {
      const statePayload = JSON.stringify({
        userId: "user-1",
        platform: "strava",
        codeVerifier: "verifier-abc",
        redirectUri: "https://example.com/api/connections/strava/oauth/callback",
      });
      kvMock.get.mockResolvedValue(statePayload);

      const res = await app.request("/connections/strava/oauth/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "auth-code-123", state: "valid-state" }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { connectionId: string; platform: string; status: string };
      expect(body.platform).toBe("strava");
      expect(body.status).toBe("active");
      expect(body.connectionId).toBeDefined();
    });

    it("returns 400 when state userId does not match authenticated user", async () => {
      const statePayload = JSON.stringify({
        userId: "different-user",
        platform: "strava",
        codeVerifier: "v",
        redirectUri: "https://example.com/api/connections/strava/oauth/callback",
      });
      kvMock.get.mockResolvedValue(statePayload);

      const res = await app.request("/connections/strava/oauth/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "c", state: "s" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("state_mismatch");
    });
  });

  // ---------------------------------------------------------------- GET / (list)

  describe("GET / (list connections)", () => {
    it("returns empty connections array when user has none", async () => {
      // Default db returns [] from select
      const res = await app.request("/connections");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { connections: unknown[] };
      expect(body.connections).toHaveLength(0);
    });

    it("maps DB status to API status correctly", async () => {
      const now = new Date();
      const rows = [
        { id: "c1", platform: "strava", status: "active", scopes: null, expiresAt: null, createdAt: now, updatedAt: now },
        { id: "c2", platform: "strava", status: "degraded", scopes: "read", expiresAt: null, createdAt: now, updatedAt: now },
        { id: "c3", platform: "strava", status: "revoked", scopes: null, expiresAt: null, createdAt: now, updatedAt: now },
      ];
      dbFactory.current = dbFactory.make(rows);

      const res = await app.request("/connections");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { connections: Array<{ id: string; status: string }> };
      expect(body.connections).toHaveLength(3);
      expect(body.connections[0]!.status).toBe("active");
      expect(body.connections[1]!.status).toBe("requires_reauth");
      expect(body.connections[2]!.status).toBe("disconnected");
    });
  });

  // ---------------------------------------------------------------- POST /disconnect

  describe("POST /:platform/disconnect", () => {
    it("returns 400 for unsupported platform", async () => {
      const res = await app.request("/connections/garmin/disconnect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 when connection is not found", async () => {
      // Default db returns [] for select
      const res = await app.request("/connections/strava/disconnect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("connection_not_found");
    });

    it("returns 200 and disconnects when connection exists", async () => {
      const conn = {
        id: "conn-1",
        userId: "user-1",
        platform: "strava",
        status: "active",
        accessTokenCipher: "enc:my-token",
        refreshTokenCipher: null,
        scopes: null,
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbFactory.current = dbFactory.make([conn]);

      const res = await app.request("/connections/strava/disconnect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { disconnected: boolean; platform: string };
      expect(body.disconnected).toBe(true);
      expect(body.platform).toBe("strava");
    });

    it("proceeds with disconnect even when token revocation fails (best-effort)", async () => {
      stravaMock.revokeToken.mockRejectedValue(new Error("platform unavailable"));
      const conn = {
        id: "conn-1",
        userId: "user-1",
        platform: "strava",
        status: "active",
        accessTokenCipher: "enc:my-token",
        refreshTokenCipher: null,
        scopes: null,
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbFactory.current = dbFactory.make([conn]);

      const res = await app.request("/connections/strava/disconnect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });
});
