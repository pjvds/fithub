import type { OAuthPlatformAdapter, OAuthResult, RawActivity } from "./types.js";

const STRAVA_AUTH_BASE = "https://www.strava.com/oauth";
const STRAVA_API_BASE = "https://www.strava.com/api/v3";

export interface StravaAdapterConfig {
  clientId: string;
  clientSecret: string;
}

export function createStravaAdapter(config: StravaAdapterConfig): OAuthPlatformAdapter {
  const { clientId, clientSecret } = config;

  return {
    platform: "strava",

    buildAuthUrl(redirectUri: string, state: string, codeChallenge: string): string {
      const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: "read,activity:read_all",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });
      return `${STRAVA_AUTH_BASE}/authorize?${params.toString()}`;
    },

    async exchangeCode(code: string, _redirectUri: string, _codeVerifier: string): Promise<OAuthResult> {
      // Strava does not support PKCE on token exchange — only code + client credentials
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
      });

      const res = await fetch(`${STRAVA_AUTH_BASE}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Strava token exchange failed (${res.status}): ${text}`);
      }

      const json = (await res.json()) as {
        access_token: string;
        refresh_token: string;
        expires_at: number;
        token_type: string;
        athlete?: { id: number };
      };

      return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? null,
        expiresAt: json.expires_at ? new Date(json.expires_at * 1000) : null,
        scopes: "read,activity:read_all",
        platformUserId: json.athlete ? String(json.athlete.id) : null,
      };
    },

    async fetchActivities(token: string, since?: Date): Promise<RawActivity[]> {
      const params = new URLSearchParams({ per_page: "50" });
      if (since) params.set("after", Math.floor(since.getTime() / 1000).toString());

      const res = await fetch(`${STRAVA_API_BASE}/athlete/activities?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 429) throw new Error("Strava rate limit exceeded");
      if (!res.ok) throw new Error(`Strava activities fetch failed (${res.status})`);

      const data = (await res.json()) as Array<{ id: number }>;
      return data.map((item) => ({ externalId: String(item.id), rawJson: item }));
    },

    async refreshToken(refreshToken: string): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: Date }> {
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      });

      const res = await fetch(`${STRAVA_AUTH_BASE}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Strava token refresh failed (${res.status}): ${text}`);
      }

      const json = (await res.json()) as {
        access_token: string;
        refresh_token: string;
        expires_at: number;
      };

      return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        expiresAt: new Date(json.expires_at * 1000),
      };
    },

    async validateToken(token: string): Promise<boolean> {
      const res = await fetch(`${STRAVA_API_BASE}/athlete`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok;
    },

    async revokeToken(token: string): Promise<void> {
      const body = new URLSearchParams({ access_token: token });
      await fetch(`${STRAVA_AUTH_BASE}/deauthorize`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
    },
  };
}
