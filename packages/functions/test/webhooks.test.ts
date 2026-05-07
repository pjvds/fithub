import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type * as FithubCore from "@fithub/core";
import type { LoggerVariables } from "../src/api/middleware/logger.js";
import type { CorrelationVariables } from "../src/api/middleware/correlation.js";
import type { Logger } from "@fithub/core";

// ------------------------------------------------------------------ hoisted mocks

const { dbFactory } = vi.hoisted(() => {
  const makeDb = () => ({
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue(null),
        }),
      }),
    }),
  });

  const dbFactory = { current: makeDb(), make: makeDb };
  return { dbFactory };
});

// ------------------------------------------------------------------ module mocks

vi.mock("sst", () => ({
  Resource: {
    FithubDb: {},
    StravaClientSecret: { value: () => "strava-client-secret" },
  },
}));

vi.mock("drizzle-orm/d1", () => ({
  drizzle: () => dbFactory.current,
}));

vi.mock("@fithub/core", async (importOriginal) => {
  const actual = await importOriginal<typeof FithubCore>();
  return {
    ...actual,
    appendOutbox: vi.fn().mockResolvedValue(undefined),
    newCloudEvent: vi.fn().mockImplementation((input: unknown) => ({ ...input as object, id: "mock-id" })),
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

type AppEnv = { Variables: LoggerVariables & CorrelationVariables };

async function buildApp() {
  const { createWebhooksRouter } = await import("../src/api/routes/webhooks.js");
  const app = new Hono<AppEnv>();
  app.use("*", (c, next) => {
    c.set("logger", mockLogger);
    c.set("correlationId", "test-correlation");
    return next();
  });
  app.route("/webhooks", createWebhooksRouter());
  return app;
}

// ------------------------------------------------------------------ helpers: build valid HMAC

async function makeSignature(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  const hex = Array.from(sigBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256=${hex}`;
}

// ------------------------------------------------------------------ tests

describe("webhooks router", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    dbFactory.current = dbFactory.make();
    app = await buildApp();
  });

  describe("GET /webhooks/strava (verification challenge)", () => {
    it("returns the hub.challenge when verify_token matches", async () => {
      // Expected token: fithub-strava-<first 8 chars of secret>
      const expectedToken = "fithub-strava-strava-c";
      const res = await app.request(
        `/webhooks/strava?hub.mode=subscribe&hub.challenge=abc123&hub.verify_token=${encodeURIComponent(expectedToken)}`,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { "hub.challenge": string };
      expect(body["hub.challenge"]).toBe("abc123");
    });

    it("returns 403 when verify_token does not match", async () => {
      const res = await app.request(
        "/webhooks/strava?hub.mode=subscribe&hub.challenge=abc123&hub.verify_token=wrong",
      );
      expect(res.status).toBe(403);
    });

    it("returns 403 when mode is not subscribe", async () => {
      const res = await app.request(
        "/webhooks/strava?hub.mode=unsubscribe&hub.challenge=abc123&hub.verify_token=fithub-strava-strava-c",
      );
      expect(res.status).toBe(403);
    });
  });

  describe("POST /webhooks/strava (event delivery)", () => {
    it("returns 200 for a valid activity.create event without signature", async () => {
      const payload = JSON.stringify({
        object_type: "activity",
        aspect_type: "create",
        owner_id: 12345,
        object_id: 67890,
        event_time: 1711929600,
      });

      const res = await app.request("/webhooks/strava", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean };
      expect(body.ok).toBe(true);
    });

    it("returns 200 for a valid event with correct HMAC signature", async () => {
      const payload = JSON.stringify({
        object_type: "activity",
        aspect_type: "create",
        owner_id: 12345,
        object_id: 67890,
        event_time: 1711929600,
      });
      const sig = await makeSignature(payload, "strava-client-secret");

      const res = await app.request("/webhooks/strava", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hub-Signature-256": sig,
        },
        body: payload,
      });
      expect(res.status).toBe(200);
    });

    it("returns 403 for an event with an invalid HMAC signature", async () => {
      const payload = JSON.stringify({ object_type: "activity", aspect_type: "create", owner_id: 1 });
      const res = await app.request("/webhooks/strava", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hub-Signature-256": "sha256=badhash",
        },
        body: payload,
      });
      expect(res.status).toBe(403);
    });

    it("returns 400 for malformed JSON body", async () => {
      const res = await app.request("/webhooks/strava", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      });
      expect(res.status).toBe(400);
    });

    it("does not write to outbox for non-create activity events", async () => {
      const { appendOutbox } = await import("@fithub/core");
      const payload = JSON.stringify({
        object_type: "activity",
        aspect_type: "update",
        owner_id: 12345,
        object_id: 67890,
      });

      await app.request("/webhooks/strava", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });

      expect(appendOutbox).not.toHaveBeenCalled();
    });
  });
});
