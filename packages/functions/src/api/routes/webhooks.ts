import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { Resource } from "sst";
import {
  appendOutbox,
  createLogger,
  ErrorCode,
  LogEvent,
  newCloudEvent,
} from "@fithub/core";
import type { LoggerVariables } from "../middleware/logger.js";
import type { CorrelationVariables } from "../middleware/correlation.js";

interface AppEnv {
  Bindings: Record<string, never>;
  Variables: LoggerVariables & CorrelationVariables;
}

type WebhookRouter = Hono<AppEnv>;

export function createWebhooksRouter(): WebhookRouter {
  const router = new Hono<AppEnv>();

  /**
   * GET /api/webhooks/strava
   * Strava subscription verification challenge.
   */
  router.get("/strava", (c) => {
    const mode = c.req.query("hub.mode");
    const challenge = c.req.query("hub.challenge");
    const verifyToken = c.req.query("hub.verify_token");

    const r = Resource as unknown as {
      StravaClientSecret: { value: () => string };
      App?: { stage?: string };
    };
    const stage = (Resource as unknown as { App?: { stage?: string } }).App?.stage ?? "unknown";
    const log = createLogger({ service: "api", env: stage, correlationId: c.var.correlationId ?? "none" });

    const expectedToken = `fithub-strava-${r.StravaClientSecret.value().slice(0, 8)}`;

    if (mode !== "subscribe" || verifyToken !== expectedToken || !challenge) {
      log.warn(LogEvent.webhookSignatureFailed, { platform: "strava", reason: "challenge_mismatch" });
      return c.json({ error: "forbidden" }, 403);
    }

    log.info(LogEvent.webhookSubscriptionCreated, { platform: "strava" });
    return c.json({ "hub.challenge": challenge });
  });

  /**
   * POST /api/webhooks/strava
   * Strava push event delivery with HMAC-SHA256 signature verification.
   */
  router.post("/strava", async (c) => {
    const r = Resource as unknown as {
      StravaClientSecret: { value: () => string };
      FithubDb: D1Database;
      App?: { stage?: string };
    };
    const stage = (Resource as unknown as { App?: { stage?: string } }).App?.stage ?? "unknown";
    const log = createLogger({ service: "api", env: stage, correlationId: c.var.correlationId ?? "none" });

    const rawBody = await c.req.raw.clone().arrayBuffer();
    const signature = c.req.header("X-Hub-Signature-256") ?? c.req.header("X-Strava-Signature");

    if (signature) {
      const valid = await verifyHmac(rawBody, r.StravaClientSecret.value(), signature);
      if (!valid) {
        log.error(LogEvent.webhookSignatureFailed, {
          code: ErrorCode.WEBHOOK_BAD_SIGNATURE,
          platform: "strava",
        });
        return c.json({ error: "invalid signature" }, 403);
      }
    }

    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(rawBody));
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }

    const event = body as {
      object_type?: string;
      aspect_type?: string;
      owner_id?: number;
      object_id?: number;
      event_time?: number;
    };

    log.info(LogEvent.webhookReceived, {
      platform: "strava",
      objectType: event.object_type,
      aspectType: event.aspect_type,
    });

    if (event.object_type === "activity" && event.aspect_type === "create" && event.owner_id) {
      const db = drizzle(r.FithubDb);
      await appendOutbox(db, newCloudEvent({
        id: crypto.randomUUID(),
        source: "fithub/strava-webhook",
        type: "webhook.strava.activity_created",
        data: {
          platform: "strava",
          ownerId: String(event.owner_id),
          activityId: String(event.object_id ?? ""),
          eventTime: event.event_time ?? Math.floor(Date.now() / 1000),
        },
      }));
    }

    return c.json({ ok: true });
  });

  return router;
}

async function verifyHmac(
  body: ArrayBuffer,
  secret: string,
  signatureHeader: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );

    const expected = signatureHeader.replace(/^sha256=/, "");
    const sigBytes = hexToBytes(expected);
    return crypto.subtle.verify("HMAC", key, sigBytes as unknown as ArrayBuffer, body);
  } catch {
    return false;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
