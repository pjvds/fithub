# Research: Strava Platform Connection (008-strava-connect)

**Feature:** 008-strava-connect
**Date:** 2026-05-08
**Status:** Complete — all decisions resolved

---

## Decision 1: OAuth Callback Route Placement

**Decision:** Create an Astro SSR page at `web/src/pages/api/connections/[platform]/oauth/callback.astro` to handle the GET redirect from Strava.

**Rationale:**
- The backend already sets `redirectUri = ${REDIRECT_BASE_URL}/api/connections/${platform}/oauth/callback`
- Placing the Astro page at the same path avoids changing the backend or the registered redirect URI on Strava's side
- The existing `auth/callback.astro` pattern confirms Astro SSR supports server-side GET handlers with `Astro.request.url` param reading, `Astro.cookies`, and `Astro.redirect()`
- The middleware runs before this page, ensuring the user is authenticated (access_token cookie) — which is correct: we need a logged-in user to complete the connection

**Alternatives considered:**
- Dedicated API endpoint separate from pages: would require a Worker route — unnecessary given Cloudflare Pages Functions handle this natively
- Redirect URI pointing directly to the backend: backend callback is POST-only; OAuth providers send a GET redirect. Changing to GET on the backend would be a bigger refactor and still wouldn't have access to the user's session cookie

**Impact:** New file `web/src/pages/api/connections/[platform]/oauth/callback.astro`. No backend changes.

---

## Decision 2: Connect Initiation Handler

**Decision:** Create a server-side Astro POST handler at `web/src/pages/api/connections/[platform]/connect.astro`. The Connect button becomes a `<form method="POST">` pointing to this route. The handler calls the backend `POST /api/connections/:platform/oauth/initiate`, reads `authUrl` from the response, and returns a `302` redirect to `authUrl`.

**Rationale:**
- Server-side form POST matches the project's existing patterns (disconnect form, auth callbacks)
- No client-side JavaScript required — the entire flow happens in Astro server functions
- The `access_token` cookie is available server-side for the authenticated backend call
- Clean and progressive — works without JS, can be progressively enhanced

**Alternatives considered:**
- Client-side fetch + `window.location`: works but requires a client island for the button, adding JS weight
- Direct link to backend initiate endpoint: backend is a separate origin (`api.fithub.space`); CORS and cookie forwarding would be complex

**Impact:** New file `web/src/pages/api/connections/[platform]/connect.astro`. `ConnectionCard.astro` and `dashboard.astro` Connect/Re-auth buttons converted from `<a>` to `<form>` elements.

---

## Decision 3: Disconnect Confirmation Dialog

**Decision:** Replace the bare form submit with a React island `DisconnectButton` component that shows an inline confirmation with two choices: "Keep activities" and "Delete activities". On confirmation it submits a form POST to `web/src/pages/api/connections/[platform]/disconnect.astro`.

**Rationale:**
- The spec requires user to explicitly choose whether to retain or delete Strava activities (AC4) — this cannot be done with a simple one-shot form submit
- A React island is consistent with the existing `SyncNowButton` pattern (already a React island)
- The confirmation requires no full-page navigation — inline dialog is better UX (§3 UX principle)
- The actual disconnect operation stays server-side via the Astro route → backend API call pattern

**Alternatives considered:**
- Two separate forms (keep / delete) always visible: clutters the UI
- Full-page confirmation route: unnecessary page navigation for a two-button dialog
- Browser `confirm()`: not accessible; cannot show structured options

**Impact:** New file `web/src/components/DisconnectButton.tsx`. New server handler `web/src/pages/api/connections/[platform]/disconnect.astro`. `ConnectionCard.astro` updated to use `DisconnectButton` island.

---

## Decision 4: REDIRECT_BASE_URL Secret Value

**Decision:** `REDIRECT_BASE_URL` SST Secret must be set to the web frontend's public origin (e.g., `https://app.fithub.space` for production, `https://dev.app.fithub.space` or `http://localhost:4321` for dev/staging).

**Rationale:**
- The backend builds `redirectUri = ${REDIRECT_BASE_URL}/api/connections/${platform}/oauth/callback`
- The Astro callback page lives at that exact path on the web frontend
- This secret must also be registered as an allowed redirect URI in the Strava API settings

**Current state:** Value is unknown/unset — this is a deployment prerequisite. Must be set before end-to-end testing.

**Impact:** Operational — set via `sst secret set REDIRECT_BASE_URL https://app.fithub.space`. No code changes.

---

## Decision 5: Existing Bug — Disconnect Form Uses `connection.id` Instead of `connection.platform`

**Decision:** Fix the `ConnectionCard.astro` disconnect form to use `connection.platform` in the action URL. Also route through the new `web/src/pages/api/connections/[platform]/disconnect.astro` server handler.

**Rationale:**
- Current `action={/api/connections/${connection.id}/disconnect}` uses the UUID (`connection.id`), which does not match the backend route `POST /api/connections/:platform/disconnect` — the form is currently non-functional
- The backend disconnect route uses `:platform` as the path segment, not the connection UUID
- This bug must be fixed as part of this feature since it blocks AC4

**Impact:** Fix in `ConnectionCard.astro` (replaced by `DisconnectButton` island). One-line fix, directly coupled to the feature.

---

## Decision 6: Dashboard Flash Messages

**Decision:** Add URL query-param-based flash messages to `dashboard.astro`. After OAuth connect completes (or fails), the web pages redirect to `/dashboard?connected=strava` or `/dashboard?error=<reason>`. The dashboard reads these params server-side and renders a dismissible banner.

**Rationale:**
- Server-side rendering of flash messages avoids a client-side JS dependency
- URL-based state is idempotent and browser-back-safe
- Consistent with the existing `/?error=missing_code` pattern in `auth/callback.astro`

**Alternatives considered:**
- Session-based flash (KV stored): unnecessary complexity; the URL param approach is simpler
- Client-side toast: would require an island just for messaging; URL params avoid this

**Impact:** Changes to `dashboard.astro` (read `?connected` and `?error` params, render banner). New `FlashBanner.astro` component or inline logic.

---

## Decision 7: Callback Route Authentication

**Decision:** The OAuth callback page at `/api/connections/[platform]/oauth/callback` must NOT be in `PUBLIC_PATHS`. It requires the user to be authenticated.

**Rationale:**
- The backend's `POST /api/connections/:platform/oauth/callback` requires a valid JWT (the auth middleware validates `userId` from the token)
- Since the callback page needs to make an authenticated call to the backend, the user must be logged in
- The OAuth flow always starts from an authenticated dashboard page — the user's session cookie is fresh when Strava redirects back
- If the session is somehow expired, the middleware will redirect to login, then back to the callback URL after re-auth (preserving state parameter)

**Impact:** No change to `PUBLIC_PATHS` in `src/middleware.ts`.
