import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { authMiddleware, verifyJwt } from "../src/api/middleware/auth.js";
import type { Logger } from "@fithub/core";

// --- helpers ----------------------------------------------------------------

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeToken(header: Record<string, unknown>, payload: Record<string, unknown>, sig = "sig"): string {
  return `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}.${b64url(sig)}`;
}

const JWKS_URL = "https://auth.example.invalid/jwks";
const FAKE_JWK = { kid: "k1", kty: "RSA", alg: "RS256", n: "n", e: "AQAB" };
const FAKE_JWKS = { keys: [FAKE_JWK] };
const FAR_FUTURE = 9_999_999_999; // ~year 2286
const JWKS_TTL = 5 * 60_000;

// Advance past JWKS cache TTL on every test to force a fresh fetch.
let fakeClock = 1_700_000_000_000;

// --- verifyJwt unit tests ---------------------------------------------------

describe("verifyJwt", () => {
  beforeEach(() => {
    fakeClock += JWKS_TTL + 1;
    vi.useFakeTimers({ now: fakeClock });
    vi.spyOn(crypto.subtle, "importKey").mockResolvedValue({} as CryptoKey);
    vi.spyOn(crypto.subtle, "verify").mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function stubFetch(jwks: unknown, ok = true, status = 200): ReturnType<typeof vi.fn> {
    const mock = vi.fn().mockResolvedValue({ ok, status, json: async () => jwks });
    vi.stubGlobal("fetch", mock);
    return mock;
  }

  it("throws malformed_jwt when token does not have exactly three parts", async () => {
    await expect(verifyJwt("only.two", JWKS_URL)).rejects.toThrow("malformed_jwt");
    await expect(verifyJwt("one.two.three.four", JWKS_URL)).rejects.toThrow("malformed_jwt");
  });

  it("throws expired when exp is in the past", async () => {
    const nowSec = Math.floor(fakeClock / 1000);
    const token = makeToken({ alg: "RS256", kid: "k1" }, { sub: "u1", exp: nowSec - 1 });
    stubFetch(FAKE_JWKS);
    await expect(verifyJwt(token, JWKS_URL)).rejects.toThrow("expired");
  });

  it("throws bad_audience when aud string does not match", async () => {
    const token = makeToken({ alg: "RS256", kid: "k1" }, { sub: "u1", exp: FAR_FUTURE, aud: "other" });
    stubFetch(FAKE_JWKS);
    await expect(verifyJwt(token, JWKS_URL, { audience: "expected" })).rejects.toThrow("bad_audience");
  });

  it("accepts token when aud is an array containing the expected audience", async () => {
    const token = makeToken({ alg: "RS256", kid: "k1" }, { sub: "u1", exp: FAR_FUTURE, aud: ["expected", "other"] });
    stubFetch(FAKE_JWKS);
    const { userId } = await verifyJwt(token, JWKS_URL, { audience: "expected" });
    expect(userId).toBe("u1");
  });

  it("skips audience check when opts.audience is not provided", async () => {
    const token = makeToken({ alg: "RS256", kid: "k1" }, { sub: "u1", exp: FAR_FUTURE, aud: "anything" });
    stubFetch(FAKE_JWKS);
    await expect(verifyJwt(token, JWKS_URL)).resolves.toMatchObject({ userId: "u1" });
  });

  it("throws bad_issuer when iss does not match", async () => {
    const token = makeToken({ alg: "RS256", kid: "k1" }, { sub: "u1", exp: FAR_FUTURE, iss: "wrong" });
    stubFetch(FAKE_JWKS);
    await expect(verifyJwt(token, JWKS_URL, { issuer: "expected" })).rejects.toThrow("bad_issuer");
  });

  it("throws missing_sub when sub is absent", async () => {
    const token = makeToken({ alg: "RS256", kid: "k1" }, { exp: FAR_FUTURE });
    stubFetch(FAKE_JWKS);
    await expect(verifyJwt(token, JWKS_URL)).rejects.toThrow("missing_sub");
  });

  it("throws when JWKS endpoint returns a non-2xx status", async () => {
    const token = makeToken({ alg: "RS256", kid: "k1" }, { sub: "u1", exp: FAR_FUTURE });
    stubFetch(null, false, 503);
    await expect(verifyJwt(token, JWKS_URL)).rejects.toThrow("jwks fetch failed: 503");
  });

  it("throws no_matching_key when kid is not found in JWKS", async () => {
    const token = makeToken({ alg: "RS256", kid: "unknown" }, { sub: "u1", exp: FAR_FUTURE });
    stubFetch(FAKE_JWKS);
    await expect(verifyJwt(token, JWKS_URL)).rejects.toThrow("no_matching_key");
  });

  it("throws bad_signature when crypto.subtle.verify returns false", async () => {
    vi.spyOn(crypto.subtle, "verify").mockResolvedValue(false);
    const token = makeToken({ alg: "RS256", kid: "k1" }, { sub: "u1", exp: FAR_FUTURE });
    stubFetch(FAKE_JWKS);
    await expect(verifyJwt(token, JWKS_URL)).rejects.toThrow("bad_signature");
  });

  it("returns userId and full payload on success", async () => {
    const token = makeToken({ alg: "RS256", kid: "k1" }, { sub: "user-abc", exp: FAR_FUTURE, iss: "auth.example.com" });
    stubFetch(FAKE_JWKS);
    const result = await verifyJwt(token, JWKS_URL);
    expect(result.userId).toBe("user-abc");
    expect(result.payload.iss).toBe("auth.example.com");
  });

  it("falls back to the first JWKS key when token header has no kid", async () => {
    const token = makeToken({ alg: "RS256" }, { sub: "u2", exp: FAR_FUTURE });
    stubFetch(FAKE_JWKS);
    const { userId } = await verifyJwt(token, JWKS_URL);
    expect(userId).toBe("u2");
  });

  it("reuses the cached JWKS within the TTL", async () => {
    const fetchMock = stubFetch(FAKE_JWKS);
    const token = makeToken({ alg: "RS256", kid: "k1" }, { sub: "u1", exp: FAR_FUTURE });
    await verifyJwt(token, JWKS_URL);
    await verifyJwt(token, JWKS_URL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// --- authMiddleware — early exit paths (no JWKS fetch needed) ---------------

describe("authMiddleware — early exit paths", () => {
  const app = new Hono();
  app.use("/protected/*", authMiddleware({ jwksUrl: "https://example.invalid/jwks" }));
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

  it("rejects malformed bearer tokens (not three parts)", async () => {
    const res = await app.request("/protected/me", { headers: { authorization: "Bearer not-a-jwt" } });
    expect(res.status).toBe(401);
  });
});

// --- authMiddleware — full verification paths --------------------------------

describe("authMiddleware — full verification paths", () => {
  let app: Hono;
  let fullClock = 2_000_000_000_000;
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;

  beforeEach(() => {
    fullClock += JWKS_TTL + 1;
    vi.useFakeTimers({ now: fullClock });
    vi.spyOn(crypto.subtle, "importKey").mockResolvedValue({} as CryptoKey);
    vi.spyOn(crypto.subtle, "verify").mockResolvedValue(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => FAKE_JWKS }));

    app = new Hono();
    // Inject a mock logger so log?.warn() is executed, covering reasonToCode().
    app.use("*", (c, next) => { c.set("logger", mockLogger); return next(); });
    app.use("/protected/*", authMiddleware({ jwksUrl: JWKS_URL, audience: "api", issuer: "auth.example.com" }));
    app.get("/protected/me", (c) => c.json({ userId: c.get("userId") }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("allows valid token and exposes userId on context", async () => {
    const token = makeToken(
      { alg: "RS256", kid: "k1" },
      { sub: "user-1", exp: FAR_FUTURE, aud: "api", iss: "auth.example.com" },
    );
    const res = await app.request("/protected/me", { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { userId: string }).userId).toBe("user-1");
  });

  it("returns 401 for an expired token", async () => {
    const nowSec = Math.floor(fullClock / 1000);
    const token = makeToken(
      { alg: "RS256", kid: "k1" },
      { sub: "user-1", exp: nowSec - 1, aud: "api", iss: "auth.example.com" },
    );
    const res = await app.request("/protected/me", { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });

  it("returns 401 for audience mismatch", async () => {
    const token = makeToken(
      { alg: "RS256", kid: "k1" },
      { sub: "user-1", exp: FAR_FUTURE, aud: "wrong-audience", iss: "auth.example.com" },
    );
    const res = await app.request("/protected/me", { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });

  it("returns 401 for issuer mismatch", async () => {
    const token = makeToken(
      { alg: "RS256", kid: "k1" },
      { sub: "user-1", exp: FAR_FUTURE, aud: "api", iss: "wrong-issuer" },
    );
    const res = await app.request("/protected/me", { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });

  it("returns 401 when signature verification fails", async () => {
    vi.spyOn(crypto.subtle, "verify").mockResolvedValue(false);
    const token = makeToken(
      { alg: "RS256", kid: "k1" },
      { sub: "user-1", exp: FAR_FUTURE, aud: "api", iss: "auth.example.com" },
    );
    const res = await app.request("/protected/me", { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });

  it("logs the correct ErrorCode for each rejection reason", async () => {
    const nowSec = Math.floor(fullClock / 1000);
    const cases: [Record<string, unknown>, string][] = [
      [{ sub: "u", exp: nowSec - 1, aud: "api", iss: "auth.example.com" }, "AUTH_EXPIRED_TOKEN"],
      [{ sub: "u", exp: FAR_FUTURE, aud: "wrong", iss: "auth.example.com" }, "AUTH_BAD_AUDIENCE"],
      [{ sub: "u", exp: FAR_FUTURE, aud: "api", iss: "wrong" }, "AUTH_BAD_ISSUER"],
    ];
    for (const [payload, expectedCode] of cases) {
      vi.mocked(mockLogger.warn).mockClear();
      const token = makeToken({ alg: "RS256", kid: "k1" }, payload);
      await app.request("/protected/me", { headers: { authorization: `Bearer ${token}` } });
      expect(vi.mocked(mockLogger.warn)).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ code: expectedCode }),
      );
    }
  });
});
