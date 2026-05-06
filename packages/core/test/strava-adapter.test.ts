import { describe, it, expect, vi, afterEach } from "vitest";
import { createStravaAdapter } from "../src/adapters/strava-adapter.js";

const CLIENT_ID = "test-strava-client";
const CLIENT_SECRET = "test-strava-secret";

describe("StravaAdapter", () => {
  const adapter = createStravaAdapter({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ------------------------------------------------------------------ buildAuthUrl
  describe("buildAuthUrl", () => {
    it("returns a URL pointing to strava.com authorize endpoint", () => {
      const url = adapter.buildAuthUrl("https://app.example.com/callback", "state-abc", "challenge-xyz");
      expect(url).toContain("strava.com");
      expect(url).toContain("/authorize?");
    });

    it("includes required OAuth + PKCE params", () => {
      const url = adapter.buildAuthUrl("https://app.example.com/callback", "state-abc", "challenge-xyz");
      const parsed = new URL(url);
      expect(parsed.searchParams.get("response_type")).toBe("code");
      expect(parsed.searchParams.get("client_id")).toBe(CLIENT_ID);
      expect(parsed.searchParams.get("state")).toBe("state-abc");
      expect(parsed.searchParams.get("code_challenge")).toBe("challenge-xyz");
      expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    });

    it("includes activity:read_all scope", () => {
      const url = adapter.buildAuthUrl("uri", "s", "c");
      expect(new URL(url).searchParams.get("scope")).toContain("activity:read_all");
    });
  });

  // ------------------------------------------------------------------ exchangeCode
  describe("exchangeCode", () => {
    it("returns OAuthResult with athlete id as platformUserId", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            access_token: "strava-access",
            refresh_token: "strava-refresh",
            expires_at: 9_999_999_999,
            athlete: { id: 12345 },
          }),
        }),
      );

      const result = await adapter.exchangeCode("auth-code", "redirect-uri", "verifier");
      expect(result.accessToken).toBe("strava-access");
      expect(result.refreshToken).toBe("strava-refresh");
      expect(result.platformUserId).toBe("12345");
      expect(result.scopes).toBe("read,activity:read_all");
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it("ignores codeVerifier (Strava does not support PKCE exchange)", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: "a",
          refresh_token: "r",
          expires_at: 0,
        }),
      });
      vi.stubGlobal("fetch", fetchMock);
      await adapter.exchangeCode("c", "uri", "some-verifier");
      const body = (fetchMock.mock.calls[0]![1] as RequestInit).body as string;
      // code_verifier must NOT appear in the request body
      expect(body).not.toContain("code_verifier");
    });

    it("throws on non-OK response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "Unauthorized" }),
      );
      await expect(adapter.exchangeCode("bad", "uri", "ver")).rejects.toThrow("Strava token exchange failed");
    });
  });

  // ------------------------------------------------------------------ refreshToken
  describe("refreshToken", () => {
    it("returns refreshed tokens", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            access_token: "new-strava-access",
            refresh_token: "new-strava-refresh",
            expires_at: 9_999_999_999,
          }),
        }),
      );

      const result = await adapter.refreshToken("old-refresh-token");
      expect(result.accessToken).toBe("new-strava-access");
      expect(result.refreshToken).toBe("new-strava-refresh");
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it("throws on failed refresh", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "bad_request" }),
      );
      await expect(adapter.refreshToken("x")).rejects.toThrow("Strava token refresh failed");
    });
  });

  // ------------------------------------------------------------------ fetchActivities
  describe("fetchActivities", () => {
    it("returns mapped activities", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => [{ id: 100 }, { id: 200 }, { id: 300 }],
        }),
      );

      const results = await adapter.fetchActivities("token");
      expect(results).toHaveLength(3);
      expect(results[0]!.externalId).toBe("100");
      expect(results[1]!.externalId).toBe("200");
    });

    it("passes after param when since is provided", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
      vi.stubGlobal("fetch", fetchMock);

      const since = new Date("2024-06-01T00:00:00Z");
      await adapter.fetchActivities("t", since);
      const url = fetchMock.mock.calls[0]![0] as string;
      expect(url).toContain(`after=${Math.floor(since.getTime() / 1000)}`);
    });

    it("throws on rate-limit (429)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));
      await expect(adapter.fetchActivities("t")).rejects.toThrow("rate limit");
    });

    it("throws on generic failure", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
      await expect(adapter.fetchActivities("t")).rejects.toThrow("Strava activities fetch failed");
    });
  });

  // ------------------------------------------------------------------ validateToken
  describe("validateToken", () => {
    it("returns true for valid token", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
      expect(await adapter.validateToken("good")).toBe(true);
    });

    it("returns false for invalid token", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
      expect(await adapter.validateToken("expired")).toBe(false);
    });
  });

  // ------------------------------------------------------------------ revokeToken
  describe("revokeToken", () => {
    it("calls deauthorize endpoint with access_token in body", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);
      await adapter.revokeToken("my-access-token");

      const [url, opts] = fetchMock.mock.calls[0]! as [string, RequestInit];
      expect(url).toContain("deauthorize");
      expect((opts.body as string)).toContain("access_token=my-access-token");
    });
  });
});
