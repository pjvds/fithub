# Quickstart: Strava Platform Connection (008-strava-connect)

**For developers picking up this feature**

---

## What You're Building

Wiring the existing Connect Strava button in the web dashboard to the backend OAuth flow. The backend (initiate, callback, disconnect) is fully implemented. You're adding three Astro SSR route handlers and updating two existing components.

---

## Prerequisites

1. **Strava API redirect URI registered** — Log into https://www.strava.com/settings/api and verify `${REDIRECT_BASE_URL}/api/connections/strava/oauth/callback` is in "Authorization Callback Domain". If not, add it.

2. **`REDIRECT_BASE_URL` SST Secret set** — Must match the web frontend origin:
   ```bash
   # Production
   npx sst secret set REDIRECT_BASE_URL https://app.fithub.space
   
   # Per-stage (dev)
   npx sst secret set REDIRECT_BASE_URL https://dev.app.fithub.space --stage dev
   ```

3. **Environment running** — The backend API Worker and web frontend must be running:
   ```bash
   npx sst dev
   ```

---

## Files to Create

```
web/src/pages/api/connections/[platform]/connect.astro      ← Connect POST handler
web/src/pages/api/connections/[platform]/oauth/callback.astro ← OAuth callback GET
web/src/pages/api/connections/[platform]/disconnect.astro   ← Disconnect POST handler
web/src/components/DisconnectButton.tsx                      ← Confirmation dialog island
```

## Files to Modify

```
web/src/components/ConnectionCard.astro   ← Fix Connect/Re-auth buttons; use DisconnectButton
web/src/pages/dashboard.astro             ← Fix empty-state button; add flash banners
```

---

## Connect Handler Pattern

```astro
---
// web/src/pages/api/connections/[platform]/connect.astro
export const prerender = false;

const { platform } = Astro.params;
const apiBaseUrl = import.meta.env.API_BASE_URL ?? "https://api.fithub.space";
const accessToken = Astro.cookies.get("access_token")?.value ?? "";
const correlationId = Astro.locals.correlationId;

if (Astro.request.method !== "POST") {
  return new Response(null, { status: 405 });
}

const res = await fetch(`${apiBaseUrl}/api/connections/${platform}/oauth/initiate`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${accessToken}`,
    "X-Correlation-ID": correlationId,
  },
  body: JSON.stringify({}),
});

if (!res.ok) {
  return Astro.redirect(`/dashboard?error=connect_failed`, 302);
}

const { authUrl } = await res.json() as { authUrl: string };
return Astro.redirect(authUrl, 302);
---
```

## Callback Handler Pattern

```astro
---
// web/src/pages/api/connections/[platform]/oauth/callback.astro
export const prerender = false;

const { platform } = Astro.params;
const { searchParams } = new URL(Astro.request.url);

const code = searchParams.get("code");
const state = searchParams.get("state");
const errorParam = searchParams.get("error");

// Strava user denied access
if (errorParam === "access_denied" || !code || !state) {
  return Astro.redirect(`/dashboard?error=access_denied`, 302);
}

const apiBaseUrl = import.meta.env.API_BASE_URL ?? "https://api.fithub.space";
const accessToken = Astro.cookies.get("access_token")?.value ?? "";
const correlationId = Astro.locals.correlationId;

const res = await fetch(`${apiBaseUrl}/api/connections/${platform}/oauth/callback`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${accessToken}`,
    "X-Correlation-ID": correlationId,
  },
  body: JSON.stringify({ code, state }),
});

if (!res.ok) {
  const data = await res.json().catch(() => ({})) as { code?: string };
  const reason = data.code === "OAUTH_STATE_INVALID" ? "expired_state" : "connect_failed";
  return Astro.redirect(`/dashboard?error=${reason}`, 302);
}

return Astro.redirect(`/dashboard?connected=${platform}`, 302);
---
```

---

## Testing Locally

1. Start dev environment: `npx sst dev`
2. Navigate to `http://localhost:4321/dashboard`
3. Click "Connect Strava" — you should be redirected to Strava's auth page
4. Grant access — you should land back on the dashboard with the "Connected" banner
5. Click "Disconnect" → choose "Keep activities" — verify Strava card shows Disconnected, activities remain
6. Repeat with "Delete activities" — verify activities removed

---

## Key Environment Variables

| Variable | Source | Used In |
|---|---|---|
| `API_BASE_URL` | SST inject | All Astro handlers |
| `AUTH_WORKER_URL` | SST inject | Middleware only (not connect flow) |
| `REDIRECT_BASE_URL` | SST Secret (backend) | Backend builds redirect URI |
| `access_token` | Cookie (HttpOnly) | All authenticated handlers |
