import type { OAuthPlatformAdapter, OAuthResult, RawActivity } from "./types.js";

const ZWIFT_AUTH_BASE = "https://secure.zwift.com/auth/realms/zwift/protocol/openid-connect";
const ZWIFT_API_BASE = "https://api.zwift.com";

export interface ZwiftAdapterConfig {
  clientId: string;
  clientSecret: string;
}

export function createZwiftAdapter(config: ZwiftAdapterConfig): OAuthPlatformAdapter {
  const { clientId, clientSecret } = config;

  return {
    platform: "zwift",

    buildAuthUrl(redirectUri: string, state: string, codeChallenge: string): string {
      const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: "openid profile",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });
      return `${ZWIFT_AUTH_BASE}/auth?${params.toString()}`;
    },

    async exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<OAuthResult> {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      });

      const res = await fetch(`${ZWIFT_AUTH_BASE}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Zwift token exchange failed (${res.status}): ${text}`);
      }

      const json = (await res.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
        sub?: string;
      };

      return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? null,
        expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null,
        scopes: json.scope ?? null,
        platformUserId: json.sub ?? null,
      };
    },

    async fetchActivities(token: string, since?: Date): Promise<RawActivity[]> {
      // Zwift activities API — endpoint derived from community research
      const profileRes = await fetch(`${ZWIFT_API_BASE}/api/profiles/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!profileRes.ok) throw new Error(`Zwift profile fetch failed (${profileRes.status})`);
      const profile = (await profileRes.json()) as { id: string };

      const params = new URLSearchParams({ limit: "50" });
      if (since) params.set("start", Math.floor(since.getTime() / 1000).toString());

      const res = await fetch(`${ZWIFT_API_BASE}/api/profiles/${profile.id}/activities?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Zwift activities fetch failed (${res.status})`);

      const data = (await res.json()) as Array<{ id: string }>;
      return data.map((item) => ({ externalId: String(item.id), rawJson: item }));
    },

    async refreshToken(refreshToken: string): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: Date }> {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      });

      const res = await fetch(`${ZWIFT_AUTH_BASE}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Zwift token refresh failed (${res.status}): ${text}`);
      }

      const json = (await res.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      const result: { accessToken: string; refreshToken?: string; expiresAt?: Date } = {
        accessToken: json.access_token,
      };
      if (json.refresh_token) result.refreshToken = json.refresh_token;
      if (json.expires_in) result.expiresAt = new Date(Date.now() + json.expires_in * 1000);
      return result;
    },

    async validateToken(token: string): Promise<boolean> {
      const res = await fetch(`${ZWIFT_AUTH_BASE}/userinfo`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok;
    },

    async revokeToken(token: string): Promise<void> {
      const body = new URLSearchParams({
        token,
        client_id: clientId,
        client_secret: clientSecret,
      });
      await fetch(`${ZWIFT_AUTH_BASE}/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
    },
  };
}
