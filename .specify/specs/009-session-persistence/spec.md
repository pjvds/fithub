# Feature Specification: Session Persistence via Silent Token Refresh

**Feature Name:** Session Persistence via Silent Token Refresh

**Feature ID:** 009-session-persistence

**Version:** 1.0.0

**Status:** Implemented

**Authored By:** Copilot

**Date:** 2026-05-08

---

## Problem Statement

**What problem does this feature solve?**

FitHub issues two session cookies on login: a short-lived access token (15 minutes) and a long-lived refresh token (30 days). Before this feature, the middleware only checked for the access token. When it expired — after 15 minutes of inactivity — users were redirected to the login page and required to complete the magic-link email flow again, even though their 30-day refresh token was still perfectly valid. This created unnecessary friction for any user who paused for more than 15 minutes between sessions.

**Why now?**

The issue was discovered during end-to-end testing of the Strava connect flow. Fixing it is low-effort and high-impact: users staying logged in for up to 30 days removes the single biggest usability complaint for an early-stage product. It also makes the Strava connect flow (which involves leaving the app for Strava's OAuth page) reliable — previously a user who took longer than 15 minutes on Strava's auth page would return to a logged-out app.

---

## Proposed Solution

**What is the feature?**

When an authenticated user's access token has expired, the system automatically obtains a new one using the existing refresh token — without the user noticing or having to take any action. The user's session is transparently extended for up to 30 days from their last login. Only if both the access token and the refresh token are absent or invalid does the system redirect the user to the login page.

**User Stories**

```
As a returning user,
I want to remain signed in between visits,
so that I can continue using FitHub without going through the login flow every 15 minutes.

As a user who leaves for an external OAuth page (e.g., Strava authorization),
I want to return to FitHub still signed in,
so that the connection flow completes without an unexpected forced login.

As a user,
I want to be automatically logged out only after 30 days of inactivity,
so that I have a sensible and predictable session lifetime.
```

---

## User Scenarios

### Scenario 1: Return Visit After Short Absence (Happy Path)

**Given:** User logged in earlier today; access token has expired (>15 min); refresh token is still valid

**When:** User opens the FitHub dashboard in their browser

**Then:**
1. The system detects the missing access token and the valid refresh token
2. A new access token (and rotated refresh token) are issued silently
3. The user lands on the dashboard as if they had never been logged out
4. No login page, no email required

**Expected Duration:** Imperceptible — sub-second token refresh in the request path

### Scenario 2: Return from External OAuth Flow

**Given:** User clicked "Connect Strava," was redirected to Strava's page for >15 minutes, and is now returning

**When:** Strava redirects the user back to the FitHub callback URL

**Then:**
1. Middleware silently refreshes the expired access token using the refresh token
2. The Strava callback completes normally
3. User lands on the dashboard with Strava connected

**Expected Duration:** Imperceptible

### Scenario 3: Truly Expired Session (Both Tokens Gone)

**Given:** User has not visited FitHub for >30 days; both cookies have expired

**When:** User visits any protected page

**Then:**
1. Middleware finds no access token and no refresh token
2. User is redirected to the login page
3. User receives a new magic-link email and completes login

**Expected Duration:** Standard login flow

### Scenario 4: Refresh Token Invalid / Revoked

**Given:** User's refresh token exists in the browser but has been revoked server-side (e.g., password changed on another device)

**When:** Middleware attempts silent refresh

**Then:**
1. The refresh call fails
2. Both cookies are cleared
3. User is redirected to the login page

**Expected Duration:** Imperceptible failure → immediate login redirect

---

## Functional Requirements

**FR1: Silent Refresh on Absent Access Token**
- When a request to a protected route has no access token cookie but has a refresh token cookie, the system attempts a silent refresh before redirecting to login
- On successful refresh, the request continues normally with the new tokens set as cookies
- On failed refresh, cookies are cleared and the user is redirected to login

**FR2: Cookie Rotation**
- A successful silent refresh sets a new access token cookie (15-minute lifetime) and a new refresh token cookie (30-day lifetime)
- The cookie attributes (httpOnly, sameSite, secure, path) are preserved identically to the initial login

**FR3: Transparent User Experience**
- The silent refresh happens within the normal request/response cycle
- No intermediate redirect or loading page is shown to the user
- The user lands directly on the page they requested

**FR4: Graceful Fallback**
- If the refresh token is absent, expired, or rejected by the auth service, the user is redirected to the standard login flow
- The login redirect preserves the originally requested URL so the user is returned there after re-authentication

**FR5: Existing Token Rotation Preserved**
- If the access token is still valid, the existing rotation behavior (OpenAuth rotates tokens on each verify call) is unchanged
- Silent refresh only activates when the access token cookie is absent

---

## Non-Functional Requirements

**NFR1: Performance**
- The silent refresh adds at most one network round-trip to the auth service per expired session
- The added latency is imperceptible to the user (<200ms in normal conditions)

**NFR2: Security**
- Refresh tokens are never exposed in URLs, JavaScript, or response bodies — only in httpOnly cookies
- A revoked or invalid refresh token causes immediate session termination (no retry loops)
- The refresh endpoint is called server-side (in middleware), not from the browser

**NFR3: Reliability**
- A network failure during the refresh attempt is treated the same as an invalid token — user is redirected to login
- No exception or error is surfaced to the user; all failure paths result in a clean login redirect

---

## Acceptance Criteria

**AC1: Silent refresh occurs when access token is absent**
- [x] A request with no `access_token` cookie but a valid `refresh_token` cookie succeeds and receives new cookies
- [x] The user is not redirected to the login page

**AC2: Both cookies are properly rotated after refresh**
- [x] New `access_token` cookie is set with 15-minute maxAge and httpOnly
- [x] New `refresh_token` cookie is set with 30-day maxAge and httpOnly

**AC3: Failed refresh redirects to login**
- [x] An invalid or expired refresh token causes a login redirect
- [x] Cookies are cleared before redirect

**AC4: No access token → no refresh token → login redirect**
- [x] A request with neither cookie redirects immediately to login

**AC5: Valid access token path is unchanged**
- [x] Requests with a valid access token go through existing verify/rotate logic unchanged

---

## Out of Scope

- **Refresh token revocation UI** — a user cannot manually invalidate their own refresh token from the dashboard; that is a future session management feature
- **Multiple concurrent sessions** — this feature does not address session isolation across devices; a refresh on one device does not invalidate others
- **Refresh token sliding window** — the 30-day lifetime is fixed from the original login; this feature does not implement rolling refresh token expiry
- **Access token lifetime configuration** — the 15-minute and 30-day values are fixed; configurable session lengths are out of scope

---

## Success Criteria

- Users who return after >15 minutes but <30 days are never shown the login page
- The login flow is triggered only when both cookies are absent or invalid
- The silent refresh completes without any user-visible delay or interruption
- The Strava OAuth connect flow (which navigates away and back) succeeds end-to-end without requiring re-login even if the access token expires during the flow

---

## Assumptions

- The auth service's refresh endpoint (`client.refresh(refreshToken)`) returns a new access token and refresh token pair on success
- The auth service correctly rejects revoked or expired refresh tokens with a non-success response
- Cookie attributes (httpOnly, sameSite: lax, secure based on HTTPS) are appropriate and consistent with the existing login cookie issuance
- The 30-day refresh token lifetime is the product-decided session length; no further configuration is required

---

## Dependencies & Related Features

**Dependencies**
- `000-backend-foundation` — OpenAuth token issuance infrastructure; `client.refresh()` API
- `008-strava-connect` — discovered the gap; silent refresh is required for Strava OAuth to work reliably

**Related Features**
- `005-web-frontend` — all protected pages benefit from session persistence via the shared middleware
- `008-strava-connect` — the external OAuth redirect scenario (Scenario 2) is the primary motivator

---

## Constitution Alignment Checklist

**Principle: Data Privacy & Security** ✅
- [x] Refresh tokens stored exclusively in httpOnly cookies — not accessible to JavaScript
- [x] Refresh call is server-side only — token never travels through the browser URL bar
- [x] Invalid tokens cause immediate session termination (no retry amplification)
- [x] Secure flag applied on HTTPS origins

**Principle: User Experience & Simplicity** ✅
- [x] User sees no login page unless both tokens are expired/invalid
- [x] No additional UI required — the feature is entirely transparent
- [x] Session lifetime (30 days) is long enough for real-world usage patterns

**Principle: Reliability & Uptime** ✅
- [x] Network failure during refresh is handled gracefully — clean redirect, no crash
- [x] Revoked tokens cause a clean logout, not a loop or broken state

**Principle: Code Quality & Testing** ✅
- [x] Implementation is a focused middleware change (<25 lines)
- [x] Existing token rotation behavior is preserved (not replaced)

**Principle: Functional & Structured Logging** ✅
- [x] Silent refresh events are logged by the auth service on the refresh endpoint
- [x] Failed refresh (audit-relevant) results in a clean redirect logged at the middleware level

---

**END OF SPECIFICATION**
