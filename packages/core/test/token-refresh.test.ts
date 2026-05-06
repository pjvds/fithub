import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { maybeRefreshToken } from "../src/crypto/token-refresh.js";
import { encryptToken } from "../src/crypto/token-vault.js";
import type { PlatformAdapter } from "../src/adapters/types.js";
import type { Logger } from "../src/logging/logger.js";

// ------------------------------------------------------------------ helpers

function genKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

const MASTER_KEY = genKey();
const CONN_ID = "conn-test-1";
const USER_ID = "user-test-1";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Logger;

const mockAdapter: PlatformAdapter = {
  platform: "zwift",
  fetchActivities: vi.fn(),
  refreshToken: vi.fn(),
  validateToken: vi.fn(),
  revokeToken: vi.fn(),
};

/** Build a minimal mock Db that simulates a connections row. */
function makeDb(row: {
  accessTokenCipher: string;
  refreshTokenCipher: string | null;
  expiresAt: Date | null;
  status: "active" | "degraded" | "revoked";
}) {
  const outboxRows: unknown[] = [];
  const updateSets: unknown[] = [];

  const valuesChain = {
    values: vi.fn().mockResolvedValue(undefined),
  };
  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: CONN_ID, userId: USER_ID, platform: "zwift", ...row }]),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined).mockImplementation((args) => {
          updateSets.push(args);
          return Promise.resolve();
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((v) => {
        outboxRows.push(v);
        return Promise.resolve();
      }),
    }),
    _outboxRows: outboxRows,
    _updateSets: updateSets,
  };
  return db as unknown as Parameters<typeof maybeRefreshToken>[0] & { _outboxRows: unknown[]; _updateSets: unknown[] };
}

describe("maybeRefreshToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns decrypted access token without refresh when not near expiry", async () => {
    const accessCipher = await encryptToken("the-access-token", MASTER_KEY);
    const db = makeDb({
      accessTokenCipher: accessCipher,
      refreshTokenCipher: null,
      // expires far in the future
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      status: "active",
    });

    const token = await maybeRefreshToken(db, CONN_ID, mockAdapter, MASTER_KEY, mockLogger);
    expect(token).toBe("the-access-token");
    expect(mockAdapter.refreshToken).not.toHaveBeenCalled();
  });

  it("returns decrypted access token without refresh when expiresAt is null", async () => {
    const accessCipher = await encryptToken("no-expiry-token", MASTER_KEY);
    const db = makeDb({
      accessTokenCipher: accessCipher,
      refreshTokenCipher: null,
      expiresAt: null,
      status: "active",
    });

    const token = await maybeRefreshToken(db, CONN_ID, mockAdapter, MASTER_KEY, mockLogger);
    expect(token).toBe("no-expiry-token");
    expect(mockAdapter.refreshToken).not.toHaveBeenCalled();
  });

  it("refreshes token when within 5-minute threshold", async () => {
    const accessCipher = await encryptToken("old-access", MASTER_KEY);
    const refreshCipher = await encryptToken("old-refresh", MASTER_KEY);
    const db = makeDb({
      accessTokenCipher: accessCipher,
      refreshTokenCipher: refreshCipher,
      // expires in 4 minutes — within the 5-minute threshold
      expiresAt: new Date(Date.now() + 4 * 60 * 1000),
      status: "active",
    });

    vi.mocked(mockAdapter.refreshToken).mockResolvedValue({
      accessToken: "fresh-access",
      refreshToken: "fresh-refresh",
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const token = await maybeRefreshToken(db, CONN_ID, mockAdapter, MASTER_KEY, mockLogger);
    expect(token).toBe("fresh-access");
    expect(mockAdapter.refreshToken).toHaveBeenCalledWith("old-refresh");
  });

  it("sets status to degraded and emits events on refresh failure", async () => {
    const accessCipher = await encryptToken("old-access", MASTER_KEY);
    const refreshCipher = await encryptToken("old-refresh", MASTER_KEY);
    const db = makeDb({
      accessTokenCipher: accessCipher,
      refreshTokenCipher: refreshCipher,
      expiresAt: new Date(Date.now() + 1_000), // 1 second left — needs refresh
      status: "active",
    });

    vi.mocked(mockAdapter.refreshToken).mockRejectedValue(new Error("token refresh rejected by platform"));

    await expect(maybeRefreshToken(db, CONN_ID, mockAdapter, MASTER_KEY, mockLogger)).rejects.toThrow(
      "token refresh rejected by platform",
    );

    // Should have called update (set degraded) + 2 outbox inserts (token.refresh_failed + connection.degraded)
    expect(db.update).toHaveBeenCalled();
    expect(db._outboxRows).toHaveLength(2);

    // Verify log error was called
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("throws when connection is not found", async () => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    } as unknown as Parameters<typeof maybeRefreshToken>[0];

    await expect(maybeRefreshToken(db, "missing-id", mockAdapter, MASTER_KEY, mockLogger)).rejects.toThrow(
      "Connection not found: missing-id",
    );
  });

  it("throws when refresh token is missing but token needs refresh", async () => {
    const accessCipher = await encryptToken("old-access", MASTER_KEY);
    const db = makeDb({
      accessTokenCipher: accessCipher,
      refreshTokenCipher: null,
      expiresAt: new Date(Date.now() + 1_000), // needs refresh
      status: "active",
    });

    await expect(maybeRefreshToken(db, CONN_ID, mockAdapter, MASTER_KEY, mockLogger)).rejects.toThrow(
      "No refresh token stored",
    );
  });
});
