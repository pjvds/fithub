# Implementation Plan: Strava Platform Connection

---

## Plan Overview

**Feature:** Strava Platform Connection (Reference: `.specify/specs/008-strava-connect/spec.md`)

**Plan ID:** plan-008-strava-connect

**Version:** 1.0.0

**Planned By:** Copilot

**Date:** 2026-05-08

---

## Problem & Approach

**Feature Problem:**
The backend OAuth infrastructure for Strava (initiate, callback, disconnect, token management) is fully implemented and tested. The web frontend currently links the "Connect Strava" button to the OpenAuth authentication issuer — which is the login provider, not the activity-ingestion connect flow. As a result, clicking "Connect Strava" starts the wrong OAuth flow and no Strava activities are ever ingested. Additionally, the disconnect form targets the wrong URL (`connection.id` instead of `connection.platform`) and provides no choice about retaining activities.

**Implementation Approach:**
Three targeted changes to the web frontend:

1. **Connect flow** — replace the `<a href>` buttons (currently pointing to `authWorkerUrl`) with server-side Astro POST handlers that call the backend OAuth initiate endpoint and redirect to the returned `authUrl`. No client-side JS needed.

2. **OAuth callback page** — add a new Astro SSR page at the path Strava redirects back to (`/api/connections/[platform]/oauth/callback`). This page reads `?code` and `?state` from query params, makes an authenticated POST to the backend callback endpoint, and redirects to the dashboard with a success/error flash param.

3. **Disconnect confirmation** — replace the bare form submit with a React island (`DisconnectButton`) that shows an inline confirmation dialog offering "Keep activities" or "Delete activities" before dispatching a server-side disconnect route that calls the backend.

One operational step: set the `REDIRECT_BASE_URL` SST Secret to the web frontend origin so the backend builds the correct redirect URI for Strava.

---

## Design Decisions & Rationale

**Decision 1: Server-Side Astro Route for Connect Initiation**
- **Choice:** `POST /api/connections/[platform]/connect` — Astro SSR page; reads `access_token` cookie, calls backend initiate, returns 302 to `authUrl`
- **Rationale:** Consistent with existing server-side patterns (`auth/callback.astro`). No client JS. Cookie-based auth handled server-side.
- **Constitution Alignment:** §3 UX (minimal friction, no JS requirement); §1 Security (token never leaves server-side handler)
- **Alternatives Considered:** Client-side fetch + `window.location` redirect — works but adds a JS island just for a button click
- **Impact:** 1 new Astro page. Convert 3 `<a>` elements to `<form>` elements across `ConnectionCard.astro` and `dashboard.astro`

**Decision 2: Astro SSR Callback Page Matching Backend redirectUri Path**
- **Choice:** `web/src/pages/api/connections/[platform]/oauth/callback.astro` — path matches `${REDIRECT_BASE_URL}/api/connections/${platform}/oauth/callback`
- **Rationale:** No backend changes needed. The redirect URI registered with Strava points here. Authenticated via middleware (access_token cookie).
- **Constitution Alignment:** §1 Security (state validation in backend, no token leakage in URL); §4 Reliability (expired state / denial handled gracefully with redirect to dashboard + flash message)
- **Alternatives Considered:** Route directly to backend — backend callback is POST-only; Strava sends GET. Impossible without this intermediary.
- **Impact:** 1 new Astro page. REDIRECT_BASE_URL must equal the web frontend origin.

**Decision 3: React Island for Disconnect Confirmation**
- **Choice:** `DisconnectButton.tsx` React island — inline dialog with "Keep activities" / "Delete activities" options; server action via new `POST /api/connections/[platform]/disconnect` Astro route
- **Rationale:** Spec requires explicit user choice (AC4). Inline dialog avoids a separate confirmation page navigation. React island is consistent with `SyncNowButton` pattern already in the project.
- **Constitution Alignment:** §3 UX (progressive disclosure — confirm before destructive action); §7 Transparency (user explicitly chooses data fate)
- **Alternatives Considered:** Two always-visible separate form buttons — clutters card; full-page confirmation route — unnecessary navigation
- **Impact:** 1 new React component. 1 new Astro disconnect handler page. `ConnectionCard.astro` updated.

**Decision 4: URL Query Params for Flash Messages**
- **Choice:** Redirect to `/dashboard?connected=strava` (success) or `/dashboard?error=<reason>` (failure)
- **Rationale:** Consistent with existing `auth/callback.astro` pattern (`/?error=missing_code`). Server-side rendering — no JS needed for the banner.
- **Constitution Alignment:** §3 UX (immediate, clear feedback); §6 Code Quality (no additional client state management)
- **Alternatives Considered:** Session/KV flash: unnecessary complexity for a one-time UI message

---

## Architecture & Component Changes

**System Diagram:**

```
User (browser)
   │
   ▼
[dashboard.astro] → [ConnectionCard.astro]
   │                         │
   │  "Connect Strava"        │
   │  <form POST>             │
   ▼                         ▼
[/api/connections/strava/connect.astro]  ←── NEW
   │  POST to backend
   ▼
[api.fithub.space] POST /api/connections/strava/oauth/initiate
   │  returns { authUrl }
   ▼
302 → strava.com/oauth/authorize
   │
   │  user grants access
   ▼
GET /api/connections/strava/oauth/callback?code=X&state=Y  ←── NEW
   │  (on app.fithub.space — Astro SSR page)
   │  POST to backend
   ▼
[api.fithub.space] POST /api/connections/strava/oauth/callback
   │  { code, state }
   │  returns 201 { connectionId, status: "active" }
   ▼
302 → /dashboard?connected=strava
   │
   ▼
[dashboard.astro] shows "Strava connected!" banner
```

**New Components:**
- `web/src/pages/api/connections/[platform]/connect.astro` — Server POST handler: calls backend initiate, redirects to authUrl
- `web/src/pages/api/connections/[platform]/oauth/callback.astro` — Server GET handler: receives Strava redirect, completes OAuth with backend, redirects to dashboard
- `web/src/pages/api/connections/[platform]/disconnect.astro` — Server POST handler: calls backend disconnect with `{ delete_data }`, redirects to dashboard
- `web/src/components/DisconnectButton.tsx` — React island: confirmation dialog with keep/delete choice

**Modified Components:**
- `web/src/components/ConnectionCard.astro` — Connect and Re-auth `<a>` links → `<form>` pointing to `/api/connections/[platform]/connect`; disconnect button → `DisconnectButton` island; remove `authWorkerUrl` prop dependency for connect buttons
- `web/src/pages/dashboard.astro` — Empty-state "Connect Strava" `<a>` → `<form>`; add flash banner logic reading `?connected`/`?error` query params
- `web/src/middleware.ts` — Add `/api/connections/` prefix paths to `PUBLIC_PATHS`? No — callback must be authenticated; no change needed

**Removed/Deprecated Components:**
- `authWorkerUrl` prop is no longer needed in `ConnectionCard.astro` for connect/re-auth buttons (it was only used for the wrong connect URL). Prop can be removed if not used elsewhere.

---

## Technical Details

### Data Model & Schema

No schema changes. See `data-model.md` for web-tier data flow shapes.

**Data Privacy Considerations:**
- No OAuth tokens are stored or passed through the web frontend — the Astro handler forwards `{ code, state }` to the backend; the backend performs token exchange
- `access_token` cookie used for backend authentication is `HttpOnly` — never accessible to JavaScript
- `?code` and `?state` query params are consumed immediately in the callback handler; the browser URL is replaced with `/dashboard?connected=strava` before the user can bookmark or share it

### API/Interface Changes

**New Web-Tier Routes (Astro SSR):**

| Method | Path | Action |
|--------|------|--------|
| `POST` | `/api/connections/[platform]/connect` | Call backend initiate → 302 to authUrl |
| `GET`  | `/api/connections/[platform]/oauth/callback` | Complete OAuth callback → 302 to dashboard |
| `POST` | `/api/connections/[platform]/disconnect` | Call backend disconnect → 302 to dashboard |

**Modified Backend Calls (no endpoint changes):**
- `POST /api/connections/strava/oauth/initiate` — unchanged; called from connect Astro handler
- `POST /api/connections/strava/oauth/callback` — unchanged; called from callback Astro page
- `POST /api/connections/strava/disconnect` — unchanged; called from disconnect Astro handler

### Integration Points

**External Services:**
- **Strava OAuth** — user is redirected to `https://www.strava.com/oauth/authorize` with `scope=activity:read_all`. Strava redirects back with `?code&state` or `?error`. No rate limits apply to the auth flow itself.

**Internal Dependencies:**
- `@fithub/core` — `Connection` type, `ConnectionsResponse` type (already imported in dashboard/ConnectionCard)
- `api.fithub.space` Worker — backend connections API (fully implemented)
- `AuthKv` KV namespace — state storage (managed by backend; TTL = 5 min)

---

## Constitution Compliance by Principle

### 1. Data Privacy & Security
**Compliance Strategy:**
- [x] Encryption: OAuth tokens never pass through the web frontend; backend handles all token encryption at rest
- [x] Access Control: All new Astro routes are behind the middleware auth guard (access_token cookie)
- [x] Audit Trail: Backend logs `oauth.initiate`, `oauth.callback.success`, `connection.disconnect` to `audit_log`
- [x] Sensitive Data: `?code` and `?state` params never reach the client DOM or browser history (consumed and replaced immediately)
- [x] CSRF: OAuth state parameter validated by backend; Astro POST handlers are same-origin forms with `form-action 'self'` CSP

**Deviations:** None

### 2. Cross-Platform Integration
**Compliance Strategy:**
- [x] Adapter Pattern: `StravaAdapter` in `@fithub/core` normalises all Strava-specific OAuth details
- [x] Platform-Agnostic Routing: new Astro routes use `[platform]` dynamic segment — can support future platforms without code changes
- [x] Error Handling: token exchange failures, state expiry, and Strava denials all redirect to dashboard with a friendly flash message

**Deviations:** None

### 3. User Experience & Simplicity
**Compliance Strategy:**
- [x] Connect in <3 clicks: Dashboard → Connect → Authorize on Strava → back to dashboard (2 user actions)
- [x] No manual page reload needed after callback
- [x] Disconnect requires confirmation with explicit choice (no silent data deletion)
- [x] All error messages are plain language (mapped from error codes to human strings server-side)

**Deviations:** None

### 4. Reliability & Uptime
**Compliance Strategy:**
- [x] Expired state (>5 min on Strava auth page): callback returns `?error=expired_state` — user sees friendly message and can retry
- [x] Strava API errors during token exchange: propagated as `?error=connect_failed`
- [x] Disconnect failure (Strava revocation fails): backend proceeds with local cleanup regardless; web shows `?error=disconnect_failed` only on database errors
- [x] Re-auth flow: existing `requires_reauth` status in backend + Re-authenticate button in `ConnectionCard` handle the re-auth scenario

**Deviations:** None

### 5. Performance & Real-Time Sync
**Compliance Strategy:**
- [x] Connect initiation redirect: Astro handler makes one authenticated API call; latency dominated by backend (<200ms); well within 1s spec target
- [x] Callback handling: one API call to backend + redirect; <500ms
- [x] Disconnect: one API call + redirect; <1s
- [x] No blocking operations; all Astro handlers are lean pass-throughs

**Deviations:** None

### 6. Code Quality & Testing
**Compliance Strategy:**
- [x] Unit tests: `DisconnectButton.tsx` (dialog state, button click handlers)
- [x] Integration tests: happy-path connect flow (mock backend), callback error scenarios, disconnect keep/delete
- [x] E2E: Full connect flow with Playwright (mock Strava redirect)
- [x] Static analysis: TypeScript strict, ESLint pass in CI (existing configuration)
- [x] Code review required before merge

**Deviations:** None

### 7. Transparency & Communication
**Compliance Strategy:**
- [x] Flash banners confirm connection and disconnection outcomes immediately
- [x] Disconnect dialog explicitly states what will be deleted before it happens
- [x] Strava connection card shows last_synced_at for transparency on sync health
- [x] Error messages link user to a retryable action (not a dead end)

**Deviations:** None

### 8. Functional & Structured Logging
**Compliance Strategy:**
- [x] Event Vocabulary: `oauth.initiate`, `oauth.callback.success`, `oauth.callback.failed`, `connection.disconnect` — all emitted by existing backend handlers
- [x] Required Fields: timestamp, level, service, userId, correlationId — all in existing backend logger middleware
- [x] Sensitive-Data Review: Astro handlers log nothing — they are thin pass-throughs. Backend handlers already reviewed and confirmed clean.
- [x] Correlation ID: `correlationId` from `Astro.locals.correlationId` passed as `X-Correlation-ID` header to backend calls (via `createApiClient`)

**Deviations:** None

---

## Implementation Breakdown

**Phase 1: Core OAuth Flow (Connect + Callback)**
- T001: Create `web/src/pages/api/connections/[platform]/connect.astro` — POST handler, calls initiate, redirects to authUrl
- T002: Create `web/src/pages/api/connections/[platform]/oauth/callback.astro` — GET handler, forwards code+state to backend, redirects to dashboard
- T003: Update `ConnectionCard.astro` — convert Connect/Re-auth `<a>` to `<form>` pointing to connect handler; remove `authWorkerUrl` dependency for connect buttons
- T004: Update `dashboard.astro` — convert empty-state "Connect Strava" `<a>` to `<form>`; add flash banner reading `?connected`/`?error` params
- T005: Set `REDIRECT_BASE_URL` SST Secret to web frontend origin
- Deliverables: End-to-end connect flow works; user can connect Strava and see dashboard update
- Dependencies: None (backend already implemented)

**Phase 2: Disconnect Confirmation**
- T006: Create `web/src/components/DisconnectButton.tsx` — React island, inline confirmation dialog with keep/delete choice
- T007: Create `web/src/pages/api/connections/[platform]/disconnect.astro` — POST handler, calls backend disconnect with `{ delete_data }`, redirects to dashboard
- T008: Update `ConnectionCard.astro` — replace bare form submit with `DisconnectButton` island
- T009: Update `dashboard.astro` — add `?disconnected` flash banner
- Deliverables: Full disconnect flow with keep/delete confirmation

**Phase 3: Testing & Validation**
- T010: Write unit tests for `DisconnectButton.tsx` (Vitest + React Testing Library)
- T011: Write integration tests for connect and callback Astro handlers (Vitest + MSW mock backend)
- T012: Write E2E Playwright test: full connect flow (mock Strava redirect), disconnect flow
- T013: Manually verify AC1–AC6 against staging
- T014: Update spec status to `Implemented`
- Deliverables: All acceptance criteria verified; tests passing in CI

---

## Dependencies & Blockers

**Critical Path:**
T001 → T002 (callback needs connect to exist for E2E testing) → T003/T004 (UI wiring) → T005 (operational) → end-to-end connect works
T006 → T007 → T008 → T009 → disconnect works
Both streams → T010–T014

**External Dependencies:**
- [x] Backend `POST /api/connections/strava/oauth/initiate` — implemented (T021)
- [x] Backend `POST /api/connections/strava/oauth/callback` — implemented (T022)
- [x] Backend `POST /api/connections/strava/disconnect` — implemented (T024)
- [ ] `REDIRECT_BASE_URL` SST Secret — must be set to web frontend origin before E2E testing

**Blockers:**
- Strava must have the web frontend callback URL registered as an allowed redirect URI in Strava API settings. If not registered, Strava will reject the OAuth flow with "redirect_uri_mismatch".

---

## Risk Management

**Risk 1: Strava Redirect URI Not Registered**
- **Likelihood:** Medium (Strava API settings need to be checked/updated)
- **Impact:** High (entire connect flow blocked)
- **Mitigation:** Before E2E testing, verify that `${REDIRECT_BASE_URL}/api/connections/strava/oauth/callback` is in the Strava API authorized redirect URIs list. Add it if missing.

**Risk 2: Middleware Intercepts Callback Page**
- **Likelihood:** Low (middleware runs but user has a valid session cookie from initiating the flow)
- **Impact:** High if triggered (user stuck in auth loop instead of completing connect)
- **Mitigation:** The callback page is not in PUBLIC_PATHS intentionally. If the access token expires while the user is on Strava's auth page (>15 min), the middleware will redirect to login then back to the callback URL (state param preserved). The 5-min state TTL in AuthKv is the real limit. If state expires first, backend returns 400 → callback page redirects to `/dashboard?error=expired_state`. This is acceptable.

**Risk 3: `REDIRECT_BASE_URL` Mismatch Between Environments**
- **Likelihood:** Medium (staging vs production vs local dev may have different URLs)
- **Impact:** Medium (OAuth fails in specific environments)
- **Mitigation:** Set `REDIRECT_BASE_URL` per-stage in SST. Document required value in quickstart.md.

---

## Testing & Validation Strategy

**Unit Testing:**
- `DisconnectButton.tsx`: dialog renders, confirm/cancel behaviour, keep vs delete selection, loading state during submit

**Integration Testing (Vitest + MSW):**
- Connect handler: mock backend initiate returning authUrl → verify 302 redirect to authUrl
- Callback handler: mock backend callback success → verify redirect to `/dashboard?connected=strava`
- Callback handler: mock Strava `?error=access_denied` → verify redirect to `/dashboard?error=access_denied`
- Callback handler: mock backend callback 400 (expired state) → verify redirect to `/dashboard?error=expired_state`
- Disconnect handler: `delete_data=false` → verify backend called with `{ delete_data: false }` + redirect to `/dashboard?disconnected=strava`
- Disconnect handler: `delete_data=true` → verify backend called with `{ delete_data: true }` + redirect

**E2E Testing (Playwright):**
- Full connect flow: dashboard → click Connect → mock Strava redirect → callback page → dashboard shows "Connected" banner
- Full disconnect flow: dashboard (connected state) → click Disconnect → confirmation dialog → Delete → dashboard shows "Disconnected"

**Manual Testing Checklist:**
- [ ] AC1: Connect Strava button on empty-state dashboard redirects to Strava auth page
- [ ] AC1: Connect Strava button on ConnectionCard also works (re-auth scenario)
- [ ] AC2: After authorizing on Strava, dashboard shows "Strava Connected" banner and Connected status badge
- [ ] AC3: After denying on Strava, dashboard shows "Connection cancelled" and Strava stays Disconnected
- [ ] AC4: Disconnect → Keep: Strava shows Disconnected, activities remain
- [ ] AC4: Disconnect → Delete: Strava shows Disconnected, activities removed
- [ ] AC5: Connection in `requires_reauth` state shows Re-authenticate button; click runs same flow
- [ ] AC6: Expired state (wait >5 min before completing Strava auth): shows friendly timeout message

---

## Rollout & Rollback Plan

**Deployment Strategy:**
Standard SST deploy on `008-strava-connect` branch after E2E tests pass. No feature flags needed — the feature is self-contained in the web frontend (new routes + changed components). Failing to set `REDIRECT_BASE_URL` means the connect flow won't work, but the rest of the site is unaffected.

**Rollback Trigger:**
- OAuth loop (users redirected to auth repeatedly after connecting)
- Disconnect silently failing (activities not removed when Delete chosen)
- Dashboard crash on callback return

**Rollback:** Revert the two `ConnectionCard.astro` and `dashboard.astro` changes to restore the (non-functional but harmless) auth worker links. Remove new pages.

**Monitoring Post-Deployment:**
- BetterStack: watch for `oauth.callback.failed` log events spiking
- Check that `connection.created` outbox events are being emitted after successful connects (via audit log or BetterStack)

---

## Success Criteria

**Feature is complete when:**
- [ ] All acceptance criteria from spec (AC1–AC6) are verified on staging
- [ ] `REDIRECT_BASE_URL` set and Strava redirect URI registered
- [ ] Unit + integration tests pass in CI
- [ ] E2E Playwright tests pass in CI
- [ ] No regressions in existing auth flow or sync flow
- [ ] Code review approved
- [ ] Spec status updated to `Implemented`

---

## Open Questions & Decisions

- **Question 1:** What is the current value of `REDIRECT_BASE_URL`? Is it set at all?
  - **Status:** Pending
  - **Resolution:** Check with `sst secret list` or inspect SST state. Set to `https://app.fithub.space` (production) or appropriate per-env value.

- **Question 2:** Is the Strava API application configured with the web callback URL as an allowed redirect URI?
  - **Status:** Pending
  - **Resolution:** Check Strava API settings at https://www.strava.com/settings/api. Add `${REDIRECT_BASE_URL}/api/connections/strava/oauth/callback` if not present.

- **Question 3:** Should the empty-state "Connect Strava" button also include an Apple Health option?
  - **Status:** Resolved — Out of scope per spec; Apple Health is mobile-only and a separate feature.

---

## Related Documents

- **Feature Specification:** `.specify/specs/008-strava-connect/spec.md`
- **Research:** `.specify/specs/008-strava-connect/research.md`
- **Data Model:** `.specify/specs/008-strava-connect/data-model.md`
- **Constitution:** `.specify/memory/constitution.md`
- **Backend Foundation Plan:** `.specify/specs/000-backend-foundation/plan.md`
- **Web Frontend Plan:** `.specify/specs/005-web-frontend/plan.md`
- **Task Breakdown:** `.specify/specs/008-strava-connect/tasks.md` (created by speckit-tasks)
