import { eq } from "drizzle-orm";
import { connections } from "../db/schema.js";
import type { PlatformAdapter } from "../adapters/types.js";
import { decryptToken, encryptToken } from "./token-vault.js";
import { appendOutbox } from "../outbox/publish.js";
import { newCloudEvent } from "../events/types.js";
import type { Logger } from "../logging/logger.js";
import { LogEvent } from "../logging/events.js";
import { ErrorCode } from "../logging/error-codes.js";
import type { Db } from "../events/idempotency.js";

/** Refresh token if it expires within this window. */
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Retrieves the decrypted access token for a connection, refreshing it first
 * if it is within `REFRESH_THRESHOLD_MS` of expiry.
 *
 * On refresh failure the connection status is set to `degraded` and
 * `token.refresh_failed` + `connection.degraded` events are emitted via the
 * outbox before re-throwing the error.
 */
export async function maybeRefreshToken(
  db: Db,
  connectionId: string,
  adapter: PlatformAdapter,
  masterKey: string,
  log: Logger,
): Promise<string> {
  const rows = await db.select().from(connections).where(eq(connections.id, connectionId)).limit(1);
  const row = rows[0];
  if (!row) throw new Error(`Connection not found: ${connectionId}`);

  const now = Date.now();
  const needsRefresh = row.expiresAt ? row.expiresAt.getTime() - now < REFRESH_THRESHOLD_MS : false;

  if (!needsRefresh) {
    return await decryptToken(row.accessTokenCipher, masterKey);
  }

  log.info(LogEvent.oauthRefreshStarted, { connectionId, platform: row.platform });

  if (!row.refreshTokenCipher) throw new Error("No refresh token stored for connection");

  const storedRefresh = await decryptToken(row.refreshTokenCipher, masterKey);

  try {
    const refreshed = await adapter.refreshToken(storedRefresh);

    const newAccessCipher = await encryptToken(refreshed.accessToken, masterKey);
    const newRefreshCipher = refreshed.refreshToken
      ? await encryptToken(refreshed.refreshToken, masterKey)
      : row.refreshTokenCipher;

    await db
      .update(connections)
      .set({
        accessTokenCipher: newAccessCipher,
        refreshTokenCipher: newRefreshCipher,
        expiresAt: refreshed.expiresAt ?? null,
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(connections.id, connectionId));

    log.info(LogEvent.oauthRefreshSucceeded, { connectionId, platform: row.platform });
    return refreshed.accessToken;
  } catch (err) {
    log.error(LogEvent.oauthRefreshFailed, {
      code: ErrorCode.OAUTH_REFRESH_FAILED,
      connectionId,
      platform: row.platform,
      err,
    });

    await db
      .update(connections)
      .set({ status: "degraded", updatedAt: new Date() })
      .where(eq(connections.id, connectionId));

    await appendOutbox(
      db,
      newCloudEvent({
        id: crypto.randomUUID(),
        source: "fithub/api",
        type: "token.refresh_failed",
        subject: row.userId,
        data: {
          userId: row.userId,
          platform: row.platform,
          connectionId,
          error: err instanceof Error ? err.message : String(err),
        },
      }),
    );

    await appendOutbox(
      db,
      newCloudEvent({
        id: crypto.randomUUID(),
        source: "fithub/api",
        type: "connection.degraded",
        subject: row.userId,
        data: {
          userId: row.userId,
          platform: row.platform,
          connectionId,
          reason: "token_refresh_failed",
        },
      }),
    );

    throw err;
  }
}
