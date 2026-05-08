import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, inArray } from "drizzle-orm";
import { Resource } from "sst";
import {
  connections,
  activities,
  activitySources,
  encryptToken,
  decryptToken,
  appendOutbox,
  newCloudEvent,
  logAuditEvent,
  createStravaAdapter,
  LogEvent,
  ErrorCode,
  type OAuthPlatformAdapter,
} from "@fithub/core";
import type { AuthVariables } from "../middleware/auth.js";
import type { LoggerVariables } from "../middleware/logger.js";
import type { CorrelationVariables } from "../middleware/correlation.js";

interface AppEnv {
  Bindings: { REDIRECT_BASE_URL: string };
  Variables: AuthVariables & LoggerVariables & CorrelationVariables;
}

/** KV state value stored during OAuth initiation. */
interface OAuthState {
  userId: string;
  platform: string;
  codeVerifier: string;
  redirectUri: string;
}

/** SST resource cast for connections route needs. */
interface Res {
  FithubDb: D1Database;
  AuthKv: KVNamespace;
  TOKEN_MASTER_KEY: { value: string };
  STRAVA_CLIENT_SECRET: { value: string };
  STRAVA_CLIENT_ID: { value: string };
  App?: { stage?: string };
}

const SUPPORTED_PLATFORMS = ["strava"] as const;
type Platform = (typeof SUPPORTED_PLATFORMS)[number];
const STATE_TTL_SECONDS = 300; // 5 minutes

function getResource(): Res {
  return Resource as unknown as Res;
}

function getAdapter(platform: Platform, r: Res): OAuthPlatformAdapter {
  return createStravaAdapter({ clientId: r.STRAVA_CLIENT_ID.value, clientSecret: r.STRAVA_CLIENT_SECRET.value });
}

/** Derive PKCE S256 code_challenge from a raw code_verifier. */
async function pkceChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Generate a cryptographically random base64url string of `len` bytes. */
function randomBase64url(len = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export const connectionsRouter = new Hono<AppEnv>();

/**
 * T021 — POST /connections/:platform/oauth/initiate
 * Generates a PKCE challenge + state, stores them in AUTH_KV, and returns the
 * platform authorization URL for the client to redirect the user to.
 */
connectionsRouter.post("/:platform/oauth/initiate", async (c) => {
  const platform = c.req.param("platform") as Platform;
  const log = c.get("logger");

  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    return c.json({ error: "platform_not_supported", code: ErrorCode.PLATFORM_NOT_SUPPORTED }, 400);
  }

  const userId = c.get("userId");
  const r = getResource();
  const db = drizzle(r.FithubDb);
  const adapter = getAdapter(platform, r);

  const state = randomBase64url(24);
  const codeVerifier = randomBase64url(48);
  const codeChallenge = await pkceChallenge(codeVerifier);
  const redirectUri = `${c.env.REDIRECT_BASE_URL}/api/connections/${platform}/oauth/callback`;

  const stateValue: OAuthState = { userId, platform, codeVerifier, redirectUri };
  await r.AuthKv.put(`oauth_state:${state}`, JSON.stringify(stateValue), { expirationTtl: STATE_TTL_SECONDS });

  const authUrl = adapter.buildAuthUrl(redirectUri, state, codeChallenge);

  log.info(LogEvent.oauthInitiateStarted, { platform, userId });
  await logAuditEvent(db, { userId, eventType: "oauth.initiate", platform });

  return c.json({ authUrl });
});

/**
 * T022 — POST /connections/:platform/oauth/callback
 * Exchanges the auth code for tokens, encrypts them, and stores the connection.
 */
connectionsRouter.post("/:platform/oauth/callback", async (c) => {
  const platform = c.req.param("platform") as Platform;
  const log = c.get("logger");

  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    return c.json({ error: "platform_not_supported", code: ErrorCode.PLATFORM_NOT_SUPPORTED }, 400);
  }

  const body = await c.req.json<{ code: string; state: string }>().catch(() => null);
  if (!body?.code || !body.state) {
    return c.json({ error: "missing_required_fields" }, 400);
  }

  const r = getResource();
  const stateRaw = await r.AuthKv.get(`oauth_state:${body.state}`);

  if (!stateRaw) {
    log.warn(LogEvent.oauthCallbackFailed, { code: ErrorCode.OAUTH_STATE_INVALID, platform });
    return c.json({ error: "invalid_or_expired_state", code: ErrorCode.OAUTH_STATE_INVALID }, 400);
  }

  const stateData = JSON.parse(stateRaw) as OAuthState;
  if (stateData.platform !== platform || stateData.userId !== c.get("userId")) {
    log.warn(LogEvent.oauthCallbackFailed, { code: ErrorCode.OAUTH_STATE_INVALID, platform });
    return c.json({ error: "state_mismatch", code: ErrorCode.OAUTH_STATE_INVALID }, 400);
  }

  await r.AuthKv.delete(`oauth_state:${body.state}`);

  const adapter = getAdapter(platform, r);

  let oauthResult;
  try {
    oauthResult = await adapter.exchangeCode(body.code, stateData.redirectUri, stateData.codeVerifier);
  } catch (err) {
    log.error(LogEvent.oauthCallbackFailed, { code: ErrorCode.OAUTH_REFRESH_FAILED, platform, err });
    return c.json({ error: "token_exchange_failed" }, 502);
  }

  const masterKey = r.TOKEN_MASTER_KEY.value;
  const accessCipher = await encryptToken(oauthResult.accessToken, masterKey);
  const refreshCipher = oauthResult.refreshToken ? await encryptToken(oauthResult.refreshToken, masterKey) : null;

  const db = drizzle(r.FithubDb);
  const connectionId = crypto.randomUUID();
  const userId = stateData.userId;

  await db
    .insert(connections)
    .values({
      id: connectionId,
      userId,
      platform,
      accessTokenCipher: accessCipher,
      refreshTokenCipher: refreshCipher,
      scopes: oauthResult.scopes,
      expiresAt: oauthResult.expiresAt,
      status: "active",
    })
    .onConflictDoUpdate({
      target: [connections.userId, connections.platform],
      set: {
        accessTokenCipher: accessCipher,
        refreshTokenCipher: refreshCipher,
        scopes: oauthResult.scopes,
        expiresAt: oauthResult.expiresAt,
        status: "active",
        updatedAt: new Date(),
      },
    });

  await appendOutbox(
    db,
    newCloudEvent({
      id: crypto.randomUUID(),
      source: "fithub/api",
      type: "connection.created",
      subject: userId,
      data: { userId, platform, connectionId },
    }),
  );

  await logAuditEvent(db, { userId, eventType: "oauth.callback.success", platform });
  log.info(LogEvent.oauthCallbackCompleted, { platform, userId, connectionId });

  return c.json({ connectionId, platform, status: "active" }, 201);
});

/**
 * T023 — GET /connections
 * Returns the authenticated user's platform connections.
 */
connectionsRouter.get("/", async (c) => {
  const userId = c.get("userId");
  const r = getResource();
  const db = drizzle(r.FithubDb);

  const rows = await db.select().from(connections).where(eq(connections.userId, userId));

  const result = rows.map((row) => ({
    id: row.id,
    platform: row.platform,
    status: mapStatus(row.status),
    scopes: row.scopes ?? undefined,
    expiresAt: row.expiresAt?.toISOString() ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  return c.json({ connections: result });
});

/**
 * T024 — POST /connections/:platform/disconnect
 * Revokes the platform OAuth token and removes the connection.
 */
connectionsRouter.post("/:platform/disconnect", async (c) => {
  const platform = c.req.param("platform") as Platform;
  const log = c.get("logger");

  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    return c.json({ error: "platform_not_supported", code: ErrorCode.PLATFORM_NOT_SUPPORTED }, 400);
  }

  const body = await c.req
    .json<{ delete_data?: boolean }>()
    .catch(() => ({}) as { delete_data?: boolean });

  const userId = c.get("userId");
  const r = getResource();
  const db = drizzle(r.FithubDb);

  const rows = await db
    .select()
    .from(connections)
    .where(and(eq(connections.userId, userId), eq(connections.platform, platform)))
    .limit(1);

  const conn = rows[0];
  if (!conn) {
    return c.json({ error: "connection_not_found", code: ErrorCode.CONNECTION_NOT_FOUND }, 404);
  }

  log.info(LogEvent.oauthDisconnectStarted, { platform, userId, connectionId: conn.id });

  const adapter = getAdapter(platform, r);
  try {
    const masterKey = r.TOKEN_MASTER_KEY.value;
    const accessToken = await decryptToken(conn.accessTokenCipher, masterKey);
    await adapter.revokeToken(accessToken);
  } catch {
    // Best-effort revocation — proceed with local cleanup regardless.
    log.warn(LogEvent.oauthCallbackFailed, {
      code: ErrorCode.OAUTH_REVOKED,
      platform,
      userId,
      connectionId: conn.id,
    });
  }

  await db.delete(connections).where(eq(connections.id, conn.id));

  if (body.delete_data) {
    const sources = await db
      .select({ activityId: activitySources.activityId })
      .from(activitySources)
      .where(and(eq(activitySources.userId, userId), eq(activitySources.platform, platform)));

    if (sources.length > 0) {
      const activityIds = sources.map((s) => s.activityId);
      await db
        .delete(activities)
        .where(and(eq(activities.userId, userId), inArray(activities.id, activityIds)));
    }
  }

  await appendOutbox(
    db,
    newCloudEvent({
      id: crypto.randomUUID(),
      source: "fithub/api",
      type: "connection.revoked",
      subject: userId,
      data: {
        userId,
        platform,
        connectionId: conn.id,
        reason: "user_initiated",
      },
    }),
  );

  await logAuditEvent(db, {
    userId,
    eventType: "connection.disconnect",
    platform,
    metadata: { delete_data: body.delete_data ?? false },
  });
  log.info(LogEvent.oauthDisconnectCompleted, { platform, userId, connectionId: conn.id });

  return c.json({ disconnected: true, platform });
});

/** Maps DB status to API-facing status string. */
function mapStatus(status: "active" | "degraded" | "revoked"): "active" | "requires_reauth" | "disconnected" {
  if (status === "degraded") return "requires_reauth";
  if (status === "revoked") return "disconnected";
  return "active";
}
