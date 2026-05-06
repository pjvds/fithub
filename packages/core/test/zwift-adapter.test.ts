import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createZwiftAdapter } from "../src/adapters/zwift-adapter.js";

const CLIENT_ID = "test-zwift-client";
const CLIENT_SECRET = "test-zwift-secret";

describe("ZwiftAdapter", () => {
  const adapter = createZwiftAdapter({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ------------------------------------------------------------------ buildAuthUrl
  describe("buildAuthUrl", () => {
    it("returns a URL pointing to the Zwift Keycloak authorize endpoint", () => {
      const url = adapter.buildAuthUrl("https://app.example.com/callback", "state123", "challenge-abc");
      expect(url).toContain("secure.zwift.com");
      expect(url).toContain("/auth?");
    });

    it("includes required PKCE params", () => {
      const url = adapter.buildAuthUrl("https://app.example.com/callback", "state123", "challenge-abc");
      const parsed = new URL(url);
      expect(parsed.searchParams.get("response_type")).toBe("code");
      expect(parsed.searchParams.get("client_id")).toBe(CLIENT_ID);
      expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
      expect(parsed.searchParams.get("code_challenge")).toBe("challenge-abc");
      expect(parsed.searchParams.get("state")).toBe("state123");
    });

    it("includes the redirect_uri", () => {
      const redirectUri = "https://app.example.com/callback";
      const url = adapter.buildAuthUrl(redirectUri, "s", "c");
      expect(new URL(url).searchParams.get("redirect_uri")).toBe(redirectUri);
    });
  });

  // ------------------------------------------------------------------ exchangeCode
  describe("exchangeCode", () => {
    it("returns OAuthResult on success", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            access_token: "zwift-access",
            refresh_token: "zwift-refresh",
            expires_in: 3600,
            scope: "openid profile",
            sub: "user-42",
          }),
        }),
      );

      const result = await adapter.exchangeCode("code-xyz", "https://example.com/cb", "verifier-abc");
      expect(result.accessToken).toBe("zwift-access");
      expect(result.refreshToken).toBe("zwift-refresh");
      expect(result.scopes).toBe("openid profile");
      expect(result.platformUserId).toBe("user-42");
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it("handles missing optional fields (no refresh token, no sub)", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ access_token: "access-only" }),
        }),
      );

      const result = await adapter.exchangeCode("c", "uri", "ver");
      expect(result.accessToken).toBe("access-only");
      expect(result.refreshToken).toBeNull();
      expect(result.expiresAt).toBeNull();
      expect(result.platformUserId).toBeNull();
    });

    it("throws on non-OK response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "invalid_grant" }),
      );
      await expect(adapter.exchangeCode("bad", "uri", "ver")).rejects.toThrow("Zwift token exchange failed");
    });
  });

  // ------------------------------------------------------------------ refreshToken
  describe("refreshToken", () => {
    it("returns new access token with rotation", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_in: 1800,
          }),
        }),
      );

      const result = await adapter.refreshToken("old-refresh");
      expect(result.accessToken).toBe("new-access");
      expect(result.refreshToken).toBe("new-refresh");
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it("returns access token without refresh when platform omits it", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ access_token: "access-no-rotate" }),
        }),
      );

      const result = await adapter.refreshToken("old");
      expect(result.accessToken).toBe("access-no-rotate");
      expect(result.refreshToken).toBeUndefined();
    });

    it("throws on failed refresh", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "unauthorized" }),
      );
      await expect(adapter.refreshToken("bad")).rejects.toThrow("Zwift token refresh failed");
    });
  });

  // ------------------------------------------------------------------ fetchActivities
  describe("fetchActivities", () => {
    it("fetches profile then activities and returns mapped results", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "99" }) }) // profile
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ id: "a1" }, { id: "a2" }],
        }); // activities

      vi.stubGlobal("fetch", fetchMock);

      const results = await adapter.fetchActivities("token-x");
      expect(results).toHaveLength(2);
      expect(results[0]!.externalId).toBe("a1");
      expect(results[1]!.externalId).toBe("a2");
    });

    it("throws when profile fetch fails", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
      await expect(adapter.fetchActivities("bad-token")).rejects.toThrow("Zwift profile fetch failed");
    });

    it("passes since param as Unix timestamp", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "5" }) })
        .mockResolvedValueOnce({ ok: true, json: async () => [] });
      vi.stubGlobal("fetch", fetchMock);

      const since = new Date("2024-01-01T00:00:00Z");
      await adapter.fetchActivities("t", since);
      const activitiesCall = fetchMock.mock.calls[1]![0] as string;
      expect(activitiesCall).toContain(`start=${Math.floor(since.getTime() / 1000)}`);
    });
  });

  // ------------------------------------------------------------------ validateToken
  describe("validateToken", () => {
    it("returns true when userinfo returns ok", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
      expect(await adapter.validateToken("good-token")).toBe(true);
    });

    it("returns false when userinfo returns 401", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
      expect(await adapter.validateToken("expired")).toBe(false);
    });
  });

  // ------------------------------------------------------------------ revokeToken
  describe("revokeToken", () => {
    it("calls logout endpoint with token", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);
      await adapter.revokeToken("token-to-revoke");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchMock.mock.calls[0]! as [string, RequestInit];
      expect(url).toContain("logout");
      expect((opts.body as string)).toContain("token-to-revoke");
    });
  });
});
