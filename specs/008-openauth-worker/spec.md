# Feature Specification: FitHub User Authentication

**Feature Name:** FitHub User Authentication

**Feature ID:** feat-008-openauth-worker

**Version:** 1.0.0

**Status:** Draft

**Authored By:** speckit-specify

**Date:** 2026-05-07

---

## Problem Statement

**What problem does this feature solve?**

FitHub has no way for users to create an account or sign in. The entire application — viewing activities, managing platform connections, reviewing sync history — sits behind an authentication gate that today lets nobody through. The backend API already enforces that every request must carry a valid identity token, but there is no service that issues those tokens. Users cannot use the app at all.

**Why now?**

All other core features (Strava data sync, activity deduplication, web dashboard) are complete or in progress. Authentication is the one remaining blocker preventing anyone from actually using FitHub. Without it, the app cannot be deployed in a usable state.

---

## Proposed Solution

**What is the feature?**

A dedicated authentication service for FitHub that lets users create accounts, sign in, and stay securely signed in across sessions. The service handles identity only — who the user is — separately from platform connections (which platforms they sync). It issues tamper-proof session credentials that the rest of the application accepts as proof of identity on every request.

**User Stories**

```
As a new visitor,
I want to create a FitHub account using my email address,
so that I can access the app without needing to share social credentials.
```

```
As a signed-in user,
I want my session to persist across browser restarts,
so that I don't have to sign in again every time I visit.
```

```
As a signed-in user,
I want to sign out securely,
so that others using my device cannot access my FitHub account.
```

**Acceptance Criteria**

- [ ] AC-1: A user can create a new account via email magic-link (no password required)
- [ ] AC-2: After successful sign-in, the user is redirected to the FitHub dashboard with an active session
- [ ] AC-3: Sessions persist across browser restarts for at least 30 days without re-authentication
- [ ] AC-4: Signing out immediately invalidates the session; subsequent requests are rejected
- [ ] AC-5: A first-time user who signs in via magic-link has a FitHub account created automatically
- [ ] AC-6: All authentication flows complete within a single browser tab (no pop-ups)
- [ ] AC-7: The service exposes a public endpoint that the API uses to verify the authenticity of every user request

---

## Constitution Alignment Checklist

### ✅ Data Privacy & Security
- [x] User data is encrypted at rest
- [x] Data transmission uses TLS
- [x] User consent is explicit and revocable — sign-in is opt-in; users can delete their account
- [x] Third-party sign-in providers (Google, Apple) are established, vetted platforms
- **Notes:** Email addresses are nullable to support Apple's private email relay. No passwords are stored (magic-link approach eliminates credential-stuffing risk). Identity stays on FitHub infrastructure — provider only confirms identity, never sees FitHub activity data.

### ✅ Cross-Platform Integration
- [x] Follows OAuth 2.0 / OIDC standards for provider integrations
- [x] Conflict detection: if a user signs in via two different providers with the same email, accounts are merged safely
- **Notes:** This feature integrates with identity providers (Apple, Google), not fitness platforms. Standard OAuth PKCE flow applies.

### ✅ User Experience & Simplicity
- [x] Sign-in completable in under 2 minutes
- [x] Error messages are clear (e.g., "Magic link expired — request a new one")
- [x] Sign-in is the primary action on the landing page — no buried navigation
- **Notes:** Magic-link removes any password management burden for users who prefer email.

### ✅ Reliability & Uptime
- [x] Auth service is stateless between requests; session state stored durably
- [x] Magic-link email delivery failures are surfaced to the user immediately
- **Notes:** If the auth service is unavailable, all authenticated app routes degrade gracefully (user sees a sign-in error, not a crash).

### ✅ Performance & Real-Time Sync
- [x] Sign-in round-trip completes in under 2 seconds under normal load
- [x] Session token verification adds less than 10ms to any API request
- **Notes:** Token verification uses cached JWKS keys after the first warm request; the initial JWKS fetch goes through the Cloudflare service binding (sub-millisecond, no public egress). Subsequent verifications are local cryptographic operations with no network call.

### ✅ Code Quality & Testing
- [x] Unit tests cover token issuance, expiry, and revocation logic
- [x] Integration tests cover each sign-in provider flow end-to-end
- [x] Security edge cases tested: replayed magic links, expired sessions, forged tokens
- **Notes:** Auth is security-critical; test coverage target is ≥90% for this feature.

### ✅ Transparency & Communication
- [x] Privacy policy updated to reflect what identity data is stored
- [x] Sign-in page explains what data is collected and why
- **Notes:** Apple Sign-In requires a visible privacy policy link; this must be in place before enabling Apple provider.

### ✅ Functional & Structured Logging
- [x] Key events logged: `auth.signup`, `auth.signin`, `auth.signout`, `auth.token.rejected`, `auth.magiclink.sent`, `auth.magiclink.expired`
- [x] No tokens, email content, or magic-link codes appear in logs
- [x] `error`-level logs carry typed error codes
- **Notes:** `userId` is the only PII allowed in structured logs. Email address must never appear in logs.
- **Known Deviation:** The constitution MUST requires audit-relevant events to be persisted via an audit log module. No such module currently exists in the FitHub codebase. For feat-008, auth events (`auth.signup`, `auth.signin`, `auth.signout`) are emitted as operational structured logs only. Persistence to a dedicated audit sink is deferred to a future cross-feature implementation.

---

## Technical Specification

### Scope

**In Scope:**
- Account creation and sign-in via email magic-link
- Session issuance and persistence across browser restarts
- Session revocation (sign-out)
- Public key endpoint for API token verification
- Automatic account creation on first sign-in
- Session refresh (transparent to the user)

**Out of Scope:**
- Username/password authentication (not planned; magic-link replaces passwords)
- Social sign-in providers (Google, Apple) — deferred to a future feature
- Multi-factor authentication beyond magic-link
- Account deletion or data export (separate GDPR feature)
- Mobile native sign-in flows (v2; web-only for v1)
- Admin impersonation or role-based access
- Strava OAuth as a sign-in mechanism (Strava connects a platform, not a FitHub identity)

### Technical Constraints

- **Platform Compatibility:** Web (all modern browsers); mobile web supported
- **API/Service Dependencies:**
  - Email delivery provider (for magic-link emails) — `EMAIL_PROVIDER_KEY` secret
  - Existing `AuthKv` key-value store (already provisioned) — used as the auth state store; OpenAuth.js generates and rotates its own signing keys automatically and stores them here
  - Existing `FithubDb` database for the `users` table (schema already defined)
- **Library:** `@openauthjs/openauth` — self-hosted OpenAuth.js issuer running as a Cloudflare Worker
- **Storage:** `CloudflareStorage` adapter from `@openauthjs/openauth/storage/cloudflare`, backed by the existing `AuthKv` KV namespace. OpenAuth.js manages its own signing keys in this KV — no external signing key is needed or accepted.
- **Service binding:** The web frontend and API worker communicate with the auth worker via a Cloudflare **service binding** AND the issuer URL — these are complementary. The service binding (`env.Auth.fetch`) handles all server-to-server calls (JWKS discovery, token exchange, verify) with zero-latency. The issuer URL (`AUTH_WORKER_URL`, already in env) is still needed for generating browser redirect URLs (the browser cannot use a service binding). SST supports service bindings via `transform` on the worker definition.
- **Frontend client:** `@openauthjs/openauth/client` — used in the Astro web app to initiate the auth flow, exchange authorization codes for tokens, refresh tokens, and verify token validity. The client is initialised with `issuer: AUTH_WORKER_URL` (for browser redirects) and `fetch: env.Auth.fetch` (for server-to-server calls via service binding). Tokens are stored in plain HttpOnly + SameSite=Strict cookies — no additional cookie-signing secret is needed since the tokens are already JWTs signed by the auth worker.
- **Provider:** `CodeProvider` with `CodeUI` from OpenAuth.js — implements the email magic-link (OTP code) flow. The `success` callback receives `value.claims.email` for the code provider. The code is delivered by email rather than displayed in the UI; on non-production stages, it falls back to console logging.
- **Token subjects:** A `user` subject is defined with `{ id: string }` — the FitHub internal user ID is embedded in the access token. The subject schema is defined once in a shared module (`packages/functions/src/shared/subjects.ts`) and imported by the auth worker, the API worker, and the web frontend.
- **Token TTL:** Access tokens: **1 hour** (resolved — see A1 remediation). Short-lived access tokens minimise the window of a stolen token; the silent refresh in `web/src/middleware.ts` keeps sessions transparent to users. Refresh tokens: 30 days.
- **Security/Compliance:**
  - Magic-link OTP codes expire in 15 minutes and are single-use (enforced by OpenAuth.js)
  - Sessions expire after 30 days; refresh tokens allow transparent session extension
  - Signing keys are auto-generated and stored in `AuthKv` by OpenAuth.js — no manual key management
  - The API worker verifies tokens by calling `client.verify(subjects, token)` via service binding; JWKS discovery is handled automatically

### Architecture & Components

```
Browser / Web App                    Auth Worker                  API Worker
──────────────────                   ───────────                  ──────────
  [Sign-in page]
       │
       │  1. Initiate sign-in
       │     (openauth/client → authorize)
       ├────────────────────────────►  POST /authorize
       │                               OpenAuth CodeProvider:
       │                               generate OTP code
       │                               store in CloudflareStorage (AuthKv)
       │                               send code via email
       │◄───────────────────────────
       │
       │  2. User clicks magic-link
       │     (email contains callback URL with code)
       ├────────────────────────────►  GET /callback?code=...
       │                               Verify OTP (single-use, 15min TTL)
       │                               Look up or create user in FithubDb
       │                               Issue access + refresh tokens
       │                               (signed with auto-managed keys in AuthKv)
       │◄───────────────────────────   Set HttpOnly session cookie
       │
       │  3. Subsequent API requests
       │     (openauth/client sends Bearer token)
       ├────────────────────────────────────────────────────────────────►  /api/*
       │                                                                    client.verify(subjects, token)
       │                                                                    ↳ auto-discovers JWKS
       │                                                                      from AUTH_WORKER_URL
       │◄────────────────────────────────────────────────────────────────  200 / 401
       │
       │  4. Token refresh
       │     (openauth/client detects expiry, exchanges refresh token)
       ├────────────────────────────►  POST /token (grant=refresh_token)
       │◄───────────────────────────   New access + refresh tokens
       │
       │  5. Sign out
       ├────────────────────────────►  POST /invalidate
       │                               Revoke refresh token in CloudflareStorage
       │◄───────────────────────────   Clear session cookie
```

**Component Responsibilities:**
- **Auth Worker** (`packages/functions/src/auth/`): OpenAuth.js `issuer` with `CodeProvider`, `CloudflareStorage` backed by `AuthKv`, user lookup/creation against `FithubDb`. Token signing is handled automatically by OpenAuth.js using keys it generates and rotates in `AuthKv` — no external signing key is used or needed. Exposes the standard OAuth 2.0 endpoints plus `/.well-known/jwks.json`.
- **Web Frontend** (`web/src/`): Uses `@openauthjs/openauth/client` to drive the auth flow — `authorize()` to start sign-in, `exchange()` to trade the callback code for tokens, `refresh()` to keep sessions alive, and `verify()` to check token validity on protected pages. The client points to `AUTH_WORKER_URL`.
- **API Worker** (`packages/functions/src/api/`): The existing custom JWKS-fetching middleware (`middleware/auth.ts`) should be **replaced** with `@openauthjs/openauth/client`. The client is initialized with `AUTH_WORKER_URL` as the issuer; `client.verify(subjects, token)` handles JWKS discovery and caching automatically. No `OPENAUTH_JWKS_URL` env var is needed.

**Infrastructure Changes:**
- `sst.config.ts`: Declare the Auth Worker with `handler: "packages/functions/src/auth/index.ts"`, `link: [authKv, fithubDb, emailProviderKey]`, and `url: true` (SST auto-generates the public URL and exposes it as `Resource.Auth.url`). **Remove `OPENAUTH_SIGNING_KEY` entirely** — OpenAuth.js manages keys in KV automatically. Configure service bindings so the web frontend and API worker can call the auth worker directly. `AUTH_WORKER_URL` in the web frontend env should reference `Resource.Auth.url` rather than being hardcoded.
- `.github/workflows/ci.yml`: Add `EMAIL_PROVIDER_KEY` to the secrets seed step.
- `specs/006-cicd-deploy-pipeline/`: Update secret inventory: remove `OPENAUTH_SIGNING_KEY` (1 removed), add `EMAIL_PROVIDER_KEY` (1 added) — net count stays at 5 SST app secrets.

---

## Implementation Approach

**High-Level Steps:**
1. Create shared subjects module at `packages/functions/src/shared/subjects.ts` using `createSubjects({ user: object({ id: string() }) })` — imported by auth worker, API worker, and web frontend
2. Scaffold auth worker at `packages/functions/src/auth/index.ts` using `issuer()` with `CodeProvider`, `CloudflareStorage({ namespace: env.AuthKv })`, and the shared `subjects`
3. Implement `sendCode`: send email via Resend (`EMAIL_PROVIDER_KEY`) on production; `console.log` the code on other stages. In `success`, resolve `value.claims.email` to a FitHub user ID via `FithubDb` (create on first sign-in), return `ctx.subject("user", { id })`
4. Register auth worker in `sst.config.ts`; link `AuthKv`, `FithubDb`, `EMAIL_PROVIDER_KEY`; **remove `OPENAUTH_SIGNING_KEY` entirely**; configure service bindings from web frontend and API worker to the auth worker (`AUTH_WORKER_URL` stays for browser redirect generation)
5. Replace the custom `middleware/auth.ts` in the API worker with `@openauthjs/openauth/client` using the auth worker service binding — `client.verify(subjects, token)` replaces all hand-rolled JWKS code
6. Integrate sign-in flow in the Astro web frontend: redirect unauthenticated requests to `/authorize`, implement `/callback` code exchange, store tokens in plain HttpOnly + SameSite=Strict cookies, verify on each protected page using `client.verify(subjects, access_token, { refresh: refresh_token })`
7. Update CI/CD: add `EMAIL_PROVIDER_KEY` to the secrets seed step

**Dependencies & Blockers:**
- [ ] Email delivery provider account and API key required before magic-link can be tested end-to-end

**Risk Assessment:**
- **Risk 1:** Email delivery reliability (magic-link not received) → **Mitigation:** Allow resend; display clear "check spam" guidance; consider multiple delivery providers
- **Risk 2:** Account re-identification (user signs in with a different email address) → **Mitigation:** One account per email address; users must use the same email they registered with

---

## Testing Strategy

**Unit Tests:**
- Magic-link code generation, expiry, and single-use enforcement
- Session token signing and verification
- Account creation on first sign-in
- Account lookup on returning sign-in
- Sign-out session revocation

**Integration Tests:**
- Full magic-link flow: request → email sent → callback → session issued → API call succeeds
- Expired magic-link returns clear error (OpenAuth enforces 15-minute TTL)
- Replayed magic-link is rejected after first use (OpenAuth single-use enforcement)
- Expired refresh token prompts re-authentication (not silent failure)
- Signed-out session (invalidated refresh token) is rejected by API

**End-to-End Tests:**
- New user: lands on sign-in page → completes email magic-link → arrives at dashboard
- Returning user: signs in → session restored → signs out → redirect to sign-in page
- Session persists across browser restart

**Manual Testing Checklist:**
- [ ] Magic-link email received and renders correctly
- [ ] Sign-in completes successfully end-to-end
- [ ] Session survives browser close and reopen
- [ ] Sign-out clears session; back button does not restore authenticated state
- [ ] Expired magic-link shows helpful error
- [ ] Replayed magic-link (used twice) is rejected

---

## Success Metrics

- **Metric 1:** Sign-in flow completes end-to-end in under 60 seconds (email delivery included) for 95% of attempts
- **Metric 2:** Zero successful authentication bypasses in security testing
- **Metric 3:** Magic-link delivery success rate ≥ 98% (measured via email provider delivery reports)
- **Metric 4:** Test coverage ≥ 90% for auth service code
- **Metric 5:** Session persistence — fewer than 1% of active sessions expire unexpectedly within their validity window

---

## Open Questions & Decisions

- **Q1:** Which sign-in providers for v1?
  - **Resolution:** Email magic-link only. Google and Apple Sign-In deferred to a future feature. Only `EMAIL_PROVIDER_KEY` is required as a new secret.

- **Q2:** Which email delivery provider should be used for magic-links?
  - **Resolution:** Resend (already referenced in prior secret naming `EMAIL_PROVIDER_KEY`); its API key is delivered to the auth worker via the `EMAIL_PROVIDER_KEY` SST secret. On non-production stages where the secret may not be set, the `sendCode` callback falls back to logging the OTP code to the console for local development.

- **Q3:** How does the signing key move from the API worker to the auth worker?
  - **Resolution:** It doesn't — `OPENAUTH_SIGNING_KEY` is not an OpenAuth.js concept and should be **removed entirely**. When using `CloudflareStorage`, OpenAuth.js generates its own signing keys automatically and persists them in the `AuthKv` KV namespace. No manual key is needed or supported.

- **Q4:** Is `OPENAUTH_JWKS_URL` needed?
  - **Resolution:** No. The `@openauthjs/openauth/client` discovers all endpoints (including JWKS) automatically when called via the auth worker service binding. Both the JWKS URL env var and the custom JWKS-fetching middleware code can be deleted.

- **Q5:** How do web frontend and API worker communicate with the auth worker?
  - **Resolution:** Via both a Cloudflare **service binding** and the issuer URL — these are complementary. The service binding (`env.Auth.fetch`) routes all server-to-server calls (verify, exchange, JWKS) directly with zero latency. The issuer URL (`AUTH_WORKER_URL`) is still required for generating browser redirect URLs — the user's browser cannot use a service binding. Confirmed by the official example: `createClient({ issuer: env.OPENAUTH_ISSUER, fetch: (input, init) => env.Auth.fetch(input, init) })`.

- **Q6:** How is `AUTH_WORKER_URL` made stage-aware instead of hardcoded?
  - **Resolution:** Using `url: true` on the SST Worker declaration exposes the URL as `Resource.Auth.url`. The web frontend's `AUTH_WORKER_URL` env var should reference this via `link: [auth]` rather than being hardcoded to `https://auth.fithub.space`. The custom domain can still be set separately; `Resource.Auth.url` is the fallback.

---

## Related Documents

- Constitution: `.specify/memory/constitution.md`
- Backend Foundation Spec: `.specify/specs/000-backend-foundation/spec.md`
- Backend Foundation Plan (Decision 9): `.specify/specs/000-backend-foundation/plan.md`
- Web Frontend Spec: `.specify/specs/005-web-frontend/spec.md`
- CI/CD Pipeline Spec: `specs/006-cicd-deploy-pipeline/spec.md`
- Implementation Plan: `specs/008-openauth-worker/plan.md` (to be created)
- Task Breakdown: `specs/008-openauth-worker/tasks.md` (to be created)
