import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { authMiddleware, type AuthVariables } from "../src/api/middleware/auth.js";
import type { LoggerVariables } from "../src/api/middleware/logger.js";
import type { Logger } from "@fithub/core";
import type { Client } from "@openauthjs/openauth/client";
import { InvalidAccessTokenError, InvalidRefreshTokenError } from "@openauthjs/openauth/error";

// --- helpers ----------------------------------------------------------------

function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    verify: vi.fn(),
    exchange: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  } as unknown as Client;
}

// --- authMiddleware — early exit paths (no verify call needed) ---------------

describe("authMiddleware — early exit paths", () => {
  const client = makeClient();
  const app = new Hono();
  app.use("/protected/*", authMiddleware({ client }));
  app.get("/protected/me", (c) => c.json({ ok: true }));

  it("rejects requests without Authorization header", async () => {
    const res = await app.request("/protected/me");
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("unauthenticated");
  });

  it("rejects requests with non-Bearer scheme", async () => {
    const res = await app.request("/protected/me", { headers: { authorization: "Basic abc" } });
    expect(res.status).toBe(401);
  });
});

// --- authMiddleware — full verification paths --------------------------------

describe("authMiddleware — full verification paths", () => {
  let app: Hono<{ Variables: AuthVariables & LoggerVariables }>;
  let client: Client;
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;

  beforeEach(() => {
    client = makeClient();
    app = new Hono<{ Variables: AuthVariables & LoggerVariables }>();
    app.use("*", (c, next) => { c.set("logger", mockLogger); return next(); });
    app.use("/protected/*", authMiddleware({ client }));
    app.get("/protected/me", (c) => c.json({ userId: c.get("userId") }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows valid token and exposes userId on context", async () => {
    vi.mocked(client.verify).mockResolvedValue({
      err: undefined,
      subject: { type: "user", properties: { id: "user-1" } },
      aud: "api",
    } as ReturnType<Client["verify"]> extends Promise<infer T> ? T : never);

    const res = await app.request("/protected/me", {
      headers: { authorization: "Bearer valid-token" },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { userId: string }).userId).toBe("user-1");
  });

  it("returns 401 when verify returns InvalidAccessTokenError", async () => {
    vi.mocked(client.verify).mockResolvedValue({
      err: new InvalidAccessTokenError(),
    } as ReturnType<Client["verify"]> extends Promise<infer T> ? T : never);

    const res = await app.request("/protected/me", {
      headers: { authorization: "Bearer expired-token" },
    });
    expect(res.status).toBe(401);
    expect(vi.mocked(mockLogger.warn)).toHaveBeenCalled();
  });

  it("returns 401 when verify returns InvalidRefreshTokenError", async () => {
    vi.mocked(client.verify).mockResolvedValue({
      err: new InvalidRefreshTokenError(),
    } as ReturnType<Client["verify"]> extends Promise<infer T> ? T : never);

    const res = await app.request("/protected/me", {
      headers: { authorization: "Bearer bad-token" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when verify throws unexpectedly", async () => {
    vi.mocked(client.verify).mockRejectedValue(new Error("network error"));

    const res = await app.request("/protected/me", {
      headers: { authorization: "Bearer anything" },
    });
    expect(res.status).toBe(401);
  });
});

