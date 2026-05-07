# Implementation Plan: FitHub User Authentication

**Feature:** FitHub User Authentication (Reference: `specs/008-openauth-worker/spec.md`)

**Plan ID:** plan-feat-008-openauth-worker

**Version:** 1.0.0

**Planned By:** speckit-plan

**Date:** 2026-05-07

---

## Problem & Approach

**Feature Problem:**
FitHub has no authentication service. The backend API enforces identity tokens on every request, but nothing issues them. No user can sign in or use the app. This is the final blocker before the app is usable.

**Implementation Approach:**
Deploy a dedicated Cloudflare Worker running an OpenAuth.js `issuer()` with `CodeProvider` (email magic-link). The auth worker stores all its state (OTP codes, sessions, refresh tokens, signing keys) in the existing `AuthKv` KV namespace via `CloudflareStorage`. The API worker's hand-rolled JWKS middleware is replaced with `@openauthjs/openauth/client`. The web frontend gains `/auth/callback` and `/auth/logout` pages. A shared `subjects.ts` module ensures token subject shapes are agreed upon by all three workers.

---

## Design Decisions & Rationale

**Decision 1: OpenAuth.js with CloudflareStorage — no custom signing key**
- **Choice:** Use `issuer()` from `@openauthjs/openauth` with `CloudflareStorage({ namespace: env.AuthKv })`. No `OPENAUTH_SIGNING_KEY`.
- **Rationale:** OpenAuth.js auto-generates and rotates signing keys when using `CloudflareStorage`. The existing `OPENAUTH_SIGNING_KEY` SST Secret was invented and is not a valid OpenAuth.js input — it must be removed.
- **Constitution Alignment:** Data Privacy & Security — keys are auto-managed, no manual key leakage risk. Code Quality — eliminates dead configuration.
- **Alternatives Considered:** Custom key management — rejected; unnecessary complexity for no security benefit.
- **Impact:** Remove `OPENAUTH_SIGNING_KEY` from `sst.config.ts`, CI secrets, and API worker link list. One SST secret decremented; one added (`EMAIL_PROVIDER_KEY`). Net count unchanged at 5.

**Decision 2: Service binding for server-to-server auth calls**
- **Choice:** Add a Cloudflare service binding from the API worker to the auth worker. Use `createClient({ issuer: env.AUTH_WORKER_URL, fetch: (input, init) => env.Auth.fetch(input, init) })`. (Note: official OpenAuth.js examples use `env.OPENAUTH_ISSUER` — in this project the env var is named `AUTH_WORKER_URL`.)
- **Rationale:** Service bindings route worker-to-worker calls within Cloudflare's network with zero-latency (no HTTP round-trip, no egress cost). Token verification happens on every API request — latency matters.
- **Constitution Alignment:** Performance & Real-Time Sync — token verification must add <10ms per request.
- **Alternatives Considered:** Public HTTP calls to `AUTH_WORKER_URL` — viable fallback if service binding proves hard to configure in SST, but adds ~20-50ms per request.
- **Impact:** SST does not expose service bindings as a first-class API for Cloudflare Workers. Must use `transform.worker.serviceBindings` in the SST Worker declaration. The auth worker name in Cloudflare will be `fithub-{stage}-Auth` (SST naming convention).
- **Fallback:** If `transform` proves unreliable, fall back to HTTP calls — the `fetch` override is optional in `createClient()`. Document as a known compromise.

**Decision 3: `AUTH_WORKER_URL` from `Resource.Auth.url` instead of hardcoded**
- **Choice:** Add `link: [auth]` to the web frontend SST declaration; set `AUTH_WORKER_URL: auth.url` (dynamically). Remove the hardcoded `https://auth.fithub.space`.
- **Rationale:** The hardcoded URL breaks non-production stages. SST's `url: true` on the auth worker exposes the generated URL as `Resource.Auth.url`. Custom domain (`auth.fithub.space`) can still be set as a Cloudflare route after deployment, but the SST-generated URL is the stage-safe default.
- **Constitution Alignment:** Reliability & Uptime — auth should work in all stages.
- **Impact:** Requires web frontend to `link: [auth]`. `auth.url` is injected into `environment`.

**Decision 4: Plain HttpOnly + SameSite=Strict cookies — no cookie signing**
- **Choice:** Store access and refresh tokens in plain `HttpOnly; Secure; SameSite=Strict` cookies. No `COOKIE_SECRET`.
- **Rationale:** Tokens are already JWTs signed by the auth worker. Tampering with a cookie value is detected by `client.verify()`. Additional cookie-signing is redundant. Confirmed by the official OpenAuth.js cloudflare-api example.
- **Constitution Alignment:** Data Privacy & Security — tokens are already cryptographically protected.
- **Alternatives Considered:** `COOKIE_SECRET` + `getSignedCookie` (mw10013 pattern) — over-engineering; rejected.

**Decision 5: Shared subjects module**
- **Choice:** Create `packages/functions/src/shared/subjects.ts` exporting `subjects = createSubjects({ user: object({ id: string() }) })`.
- **Rationale:** Auth worker, API worker, and web frontend must all agree on the exact token subject shape. Divergence causes silent `verify()` failures. A shared module enforces consistency at compile time.
- **Constitution Alignment:** Code Quality & Testing — single source of truth, type-safe.
- **Impact:** All three consumers import from the same path.

---

## Architecture & Component Changes

**System Diagram:**

```
Browser / Web App (Astro)        Auth Worker              API Worker
────────────────────────         ───────────              ──────────

  / or /dashboard (public)
     │ [no session cookie]
     ↓ redirect
  GET {AUTH_WORKER_URL}/authorize
     ──────────────────────────────────────►
                                    CodeProvider generates OTP
                                    Stores code in AuthKv
                                    Sends email via Resend
     ◄──────────────────────────────────────
     │ [email arrives, user clicks link]
  GET /auth/callback?code=…&state=…
     │ (web frontend page)
     │ calls auth.exchange(code)
     ─── via service binding or HTTP ──────►
                                    Verifies OTP (single-use, 15min)
                                    Looks up or creates user in FithubDb
                                    Issues access + refresh tokens
     ◄─── access_token + refresh_token ─────
     │ [sets HttpOnly cookies]
     ↓ redirect to /dashboard

  /api/* requests
     ─ Bearer: access_token ─────────────────────────────────────────►
                                                    client.verify(subjects, token)
                                                    (via Auth service binding)
     ◄────────────────────────────────────────────────────────────────

  Token refresh (transparent)
     ─ exchange refresh_token ────────────►
     ◄─ new access + refresh tokens ───────

  Sign-out (GET /auth/logout)
     ─ invalidate session ────────────────►
                                    Revokes refresh token in AuthKv
     ◄── clears cookies ──────────────────
```

**New Components:**
- `packages/functions/src/auth/index.ts`: OpenAuth.js `issuer()` worker — the authentication service
- `packages/functions/src/shared/subjects.ts`: Shared token subject schema
- `web/src/pages/auth/callback.astro`: Handles the OAuth callback — exchanges code for tokens, sets cookies
- `web/src/pages/auth/logout.astro`: Signs the user out — calls `invalidate`, clears cookies

**Modified Components:**
- `packages/functions/src/api/middleware/auth.ts`: Replace entire file (169 lines of custom JWKS code) with `@openauthjs/openauth/client`-based middleware. Preserve the `AuthVariables` and `authMiddleware` exports so call sites are unchanged.
- `packages/functions/src/api/index.ts`: Update `authMiddleware` initialisation — pass `createClient` instead of `jwksUrl`.
- `web/src/lib/session.ts`: Optionally update `getSession` to use `client.verify()` for full server-side token validation instead of decode-only. (Deferred to a follow-up — middleware redirect handles invalid tokens adequately for v1.)
- `sst.config.ts`: Remove `openauthSigningKey`, add `emailProviderKey`, add `auth` worker declaration, update `AUTH_WORKER_URL` to dynamic, add service bindings.
- `.github/workflows/ci.yml`: Replace `OPENAUTH_SIGNING_KEY` with `EMAIL_PROVIDER_KEY` in secrets seed step.

**Removed/Deprecated:**
- `OPENAUTH_SIGNING_KEY` SST Secret — removed entirely. No replacement (auto-managed by OpenAuth.js).

---

## Technical Details

### Data Model & Schema

**No new entities required.** The `users` table already exists:

```
users (existing — no migration needed)
  id:          text PRIMARY KEY       — FitHub internal UUID
  email:       text NOT NULL UNIQUE   — used as the identity key in the success callback
  displayName: text                   — optional display name
  createdAt:   timestamp_ms
  updatedAt:   timestamp_ms
```

**OpenAuth.js KV state (managed automatically by `CloudflareStorage`):**
```
AuthKv (existing KV namespace — no configuration needed)
  Signing keys    — auto-generated and rotated by OpenAuth.js
  OTP codes       — 15-minute TTL, single-use
  Sessions        — access + refresh token metadata
  Refresh tokens  — 30-day TTL
```

**Schema Migrations:** None required.

**Data Privacy Considerations:**
- Encryption: KV values are encrypted at rest by Cloudflare. TLS 1.3 in transit.
- Retention: OTP codes auto-expire in 15 minutes. Refresh tokens in 30 days. No raw email content stored.
- User consent: Sign-in is explicit; users initiate the magic-link request.
- PII in logs: Only `userId` (internal). Email addresses MUST NOT appear in logs.

### API/Interface Changes

**Auth Worker endpoints (provided by OpenAuth.js `issuer()` — no custom code needed):**
- `GET  /authorize` — starts the OTP flow; redirects to `CodeUI` challenge page
- `GET  /callback` — processes the submitted code; issues tokens; redirects to `redirect_uri`
- `POST /token` — token exchange (code → tokens) and refresh (refresh_token → new tokens)
- `POST /invalidate` — revokes a refresh token (sign-out)
- `GET  /.well-known/oauth-authorization-server` — OAuth 2.0 server metadata
- `GET  /.well-known/jwks.json` — public JWKs for token verification

**New Web Frontend routes:**
- `GET  /auth/callback?code=…&state=…` — exchanges code for tokens, sets cookies, redirects to dashboard
- `GET  /auth/logout` — calls auth invalidate, clears cookies, redirects to `/`

**Modified API Worker — internal interface:**
```
Before: authMiddleware({ jwksUrl: string }) → calls fetchJwks() manually
After:  authMiddleware({ client: OpenAuthClient }) → calls client.verify(subjects, token)
```

### Integration Points

**External Services:**
- **Resend** (email delivery): Called from `sendCode` in auth worker. API key via `EMAIL_PROVIDER_KEY` SST secret. On non-production stages, falls back to `console.log(code)`.

**Internal Dependencies:**
- `AuthKv` (existing KV): `CloudflareStorage` namespace binding — linked via SST `link: [authKv]`
- `FithubDb` (existing D1): User lookup and creation in `success` callback — linked via SST `link: [db]`
- `@openauthjs/openauth` (existing in `packages/functions/package.json`): Auth worker and API worker
- `@openauthjs/openauth/client` (to be added to `web/package.json`): Web frontend

---

## Constitution Compliance by Principle

### 1. Data Privacy & Security
**Compliance Strategy:**
- [x] Encryption: KV at rest via Cloudflare. TLS 1.3 in transit. Tokens are JWTs signed by auto-managed keys.
- [x] Access Control: HttpOnly + SameSite=Strict cookies. Service binding limits auth worker exposure.
- [x] Audit Trail: `auth.signup`, `auth.signin`, `auth.signout`, `auth.token.rejected`, `auth.magiclink.sent`, `auth.magiclink.expired` events logged with `userId` only.
- [x] Vendor Assessment: Resend is an established email delivery SaaS. OpenAuth.js is OSS with no external token exchange.

**Deviations:** None.

### 2. Cross-Platform Integration
**Compliance Strategy:**
- [x] This feature integrates with Resend (email), not fitness platforms. Standard HTTP API.
- [x] No conflict detection needed — email is the unique identity key; accounts are per-email.

**Deviations:** None directly applicable to this feature.

### 3. User Experience & Simplicity
**Compliance Strategy:**
- [x] Setup Flow: Sign-in is 2 steps — enter email → click link. Under 2 minutes.
- [x] Error Messaging: "Magic link expired — request a new one." "Invalid link." Clear, actionable.
- [x] No advanced options surfaced; sign-in page is intentionally minimal.
- [x] Accessibility: Standard `<a>` and `<form>` elements; keyboard-navigable.

**Deviations:** None.

### 4. Reliability & Uptime
**Compliance Strategy:**
- [x] Auth worker is stateless per-request; all state in `AuthKv` (Cloudflare-managed HA).
- [x] Email delivery failures surfaced immediately; retry UI provided.
- [x] If auth worker is unavailable, web middleware redirects to sign-in (graceful degradation).

**Deviations:** No offline auth queue — signing in inherently requires connectivity. Documented by design.

### 5. Performance & Real-Time Sync
**Compliance Strategy:**
- [x] Token verification via service binding: <10ms per API request target.
- [x] `client.verify()` caches JWKS internally — no repeated network calls.
- [x] Sign-in round-trip (excluding email delivery) <2 seconds P95.

**Deviations:** None.

### 6. Code Quality & Testing
**Compliance Strategy:**
- [x] Test Coverage: ≥90% for auth service code (higher than standard 80% — auth is security-critical).
- [x] Integration Tests: Full magic-link flow, expired link, replay attack, expired session.
- [x] E2E Tests: New user sign-in, returning user sign-in, sign-out.
- [x] Code Review: Required before merge.
- [x] Static Analysis: Existing TypeScript + ESLint CI checks apply.
- [x] Custom JWKS middleware tests (18 tests) must be updated or replaced.

**Deviations:** None.

### 7. Transparency & Communication
**Compliance Strategy:**
- [x] Privacy policy link required on sign-in page (especially for future Apple Sign-In).
- [x] Sign-in page describes what data is collected.
- [x] Known limitation: Apple Sign-In deferred to future feature — documented in spec.

**Deviations:** None.

### 8. Functional & Structured Logging
**Compliance Strategy:**
- [x] Event Vocabulary: `auth.signup`, `auth.signin`, `auth.signout`, `auth.token.rejected`, `auth.token.accepted`, `auth.magiclink.sent`, `auth.magiclink.expired`
- [x] Required Fields: `timestamp`, `level`, `service: "auth"`, `env`, `correlationId`, `userId` (post-auth)
- [x] Sensitive-Data Review: No tokens, email content, OTP codes, or email addresses in logs.
- [x] Error Codes: `AUTH_MISSING_TOKEN`, `AUTH_EXPIRED_TOKEN`, `AUTH_INVALID_TOKEN` (already in `@fithub/core` `ErrorCode`)
- [x] Correlation: Correlation ID propagated from web middleware through API worker.
- [x] Audit vs. Operational: `auth.signup` and `auth.signout` are audit-relevant events.

**Deviations:** None.

---

## Implementation Breakdown

**Phase 1: Infrastructure & Shared Foundation**
- Add `@openauthjs/openauth` to `web/package.json`
- Create `packages/functions/src/shared/subjects.ts` — `createSubjects({ user: object({ id: string() }) })`
- Update `sst.config.ts`:
  - Remove `openauthSigningKey` Secret and all references
  - Add `emailProviderKey = new sst.Secret("EMAIL_PROVIDER_KEY")`
  - Declare `auth` worker: `link: [authKv, db, emailProviderKey]`, `url: true`
  - Update `AUTH_WORKER_URL` in web env to `auth.url` (dynamic)
  - Add `link: [auth]` to web frontend SST declaration
  - Add service bindings from API worker and web to auth worker via `transform`
- Deliverables: SST infrastructure ready; shared subjects importable from all workers
- Dependencies: None (greenfield infra work)

**Phase 2: Auth Worker**
- Create `packages/functions/src/auth/index.ts` — `issuer()` with `CodeProvider`, `CloudflareStorage`, shared `subjects`
- Implement `sendCode`: Resend on production, `console.log` on other stages
- Implement `success` callback: resolve `value.claims.email` → look up or create user in `FithubDb` → `ctx.subject("user", { id })`
- Deliverables: Auth worker deployable and testable end-to-end for email magic-link
- Dependencies: Phase 1 complete (infra, shared subjects)

**Phase 3: API Worker Migration**
- Replace `packages/functions/src/api/middleware/auth.ts` — rewrite using `createClient()` from `@openauthjs/openauth/client` with service binding to auth worker; preserve `authMiddleware` and `AuthVariables` exports
- Update `packages/functions/src/api/index.ts` — initialise client with `issuer` + service binding `fetch`; pass to `authMiddleware`
- Update `packages/functions/src/api/index.ts` — remove `OPENAUTH_JWKS_URL` fallback reference
- Deliverables: API worker uses OpenAuth.js for token verification; no custom JWKS code
- Dependencies: Phase 1 (subjects), Phase 2 (auth worker running for integration tests)

**Phase 4: Web Frontend**
- Create `web/src/pages/auth/callback.astro` — receives `code` + `state` query params, calls `client.exchange()`, sets `access_token` + `refresh_token` cookies (HttpOnly, Secure, SameSite=Strict), redirects to dashboard (or `redirect_uri`)
- Create `web/src/pages/auth/logout.astro` — calls auth worker `/invalidate`, clears cookies, redirects to `/`
- Update `web/src/middleware.ts` — initialise `createClient()` with auth worker URL; use `client.verify()` for server-side token validation on protected routes (replacing decode-only approach in `session.ts`)
- Deliverables: Full sign-in, session persistence, and sign-out working in the browser
- Dependencies: Phase 1 (infra), Phase 2 (auth worker)

**Phase 5: CI/CD & Cleanup**
- Update `.github/workflows/ci.yml`: replace `OPENAUTH_SIGNING_KEY` with `EMAIL_PROVIDER_KEY` in secrets seed step
- Update `specs/006-cicd-deploy-pipeline/spec.md` or its secret inventory: remove `OPENAUTH_SIGNING_KEY`, add `EMAIL_PROVIDER_KEY`
- Deliverables: CI passes; secrets inventory accurate
- Dependencies: Phase 1 (infra changes committed)

**Phase 6: Testing**
- Write unit tests for `shared/subjects.ts`
- Write unit tests for auth worker `success` callback (user lookup, user creation)
- Write integration tests: full magic-link flow (mock email), expired code, replayed code, expired refresh token, signed-out session
- Update/replace existing 18-test suite for `auth.ts` middleware
- Write E2E tests: new user sign-in, returning user sign-in, sign-out, session persistence
- Deliverables: ≥90% coverage on auth code; all existing tests still pass
- Dependencies: Phases 2–4 complete

---

## Dependencies & Blockers

**Critical Path:**
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6

**External Dependencies:**
- [x] Resend account + API key: required before magic-link can be tested end-to-end with real email delivery. On non-production stages, `console.log` fallback allows development without the key.

**Known Constraints:**
- SST Cloudflare service bindings require `transform.worker.serviceBindings` — not a first-class SST API. If this proves unreliable, fall back to HTTP calls via `AUTH_WORKER_URL` for server-to-server. The `createClient()` `fetch` override is optional; omitting it uses global fetch transparently.

---

## Risk Management

**Risk 1: SST service binding configuration**
- **Likelihood:** Medium
- **Impact:** Medium (performance degradation only; auth still works via HTTP fallback)
- **Mitigation:** Try `transform.worker.serviceBindings` first. If blocked, use HTTP calls to `Resource.Auth.url` — document as performance compromise. Revisit once SST adds native service binding support.

**Risk 2: Email delivery reliability**
- **Likelihood:** Low (Resend is reliable; ~99.5% delivery SLA)
- **Impact:** High (user cannot sign in if email not received)
- **Mitigation:** Resend email, show "check spam" guidance, allow requesting a new link. On dev stages, OTP code logged to console.

**Risk 3: OpenAuth.js version compatibility**
- **Likelihood:** Low (`^0.4.0` is already installed)
- **Impact:** Medium (API changes could break auth worker implementation)
- **Mitigation:** Pin to `0.4.x` for this implementation. Validate against installed version before writing code.

---

## Testing & Validation Strategy

**Unit Testing:**
- `shared/subjects.ts`: subject schema validates correct and incorrect shapes
- Auth worker `success` callback: existing user lookup, first-time user creation, DB error handling
- New `auth.ts` middleware: valid token accepted, expired token rejected, missing token rejected, malformed token rejected

**Integration Testing:**
- Full magic-link flow: `POST /authorize` → `sendCode` called → code in KV → `GET /callback?code=…` → tokens issued → API request succeeds
- Expired OTP (>15 min): callback returns error; `auth.magiclink.expired` logged
- Replayed OTP (used twice): second use rejected; `auth.token.rejected` logged
- Expired refresh token: `POST /token` returns 401; client redirected to sign-in
- Invalidated session: `POST /invalidate` → subsequent API calls return 401

**E2E Tests:**
1. New user: lands on `/` → clicks sign-in → enters email → clicks link in email (console in dev) → arrives at `/dashboard` with session
2. Returning user: has valid session cookie → visits `/` → redirected to `/dashboard`
3. Sign-out: clicks sign-out → session cleared → visit `/dashboard` → redirected to `/`

**Security Testing:**
- Forged JWT (tampered `sub`) rejected by `client.verify()`
- Token from wrong issuer rejected
- Session cookie without HttpOnly attribute rejected by browser
- CSRF: SameSite=Strict prevents cross-origin cookie submission

**Manual Testing Checklist:**
- [ ] Magic-link email received and renders correctly (text + HTML)
- [ ] Sign-in completes successfully end-to-end
- [ ] Session survives browser close and reopen
- [ ] Sign-out clears session; back button does not restore authenticated state
- [ ] Expired magic-link shows helpful error ("expired — request a new one")
- [ ] Replayed magic-link (second use) is rejected
- [ ] Auth flow works on mobile browser

---

## Rollout & Rollback Plan

**Deployment Strategy:**
Sequential phases deployed to staging first. Auth worker deployed before web frontend changes go live (ensures token issuance is ready before clients try to use it).

**Rollback Trigger:**
If sign-in success rate drops below 95% in the first hour post-deployment, or any authentication bypass is detected.

**Rollback Plan:**
- Auth worker: SST deploy previous version
- API worker: Previous middleware reactivation (revert `auth.ts` commit)
- `OPENAUTH_SIGNING_KEY` removal can be reverted in `sst.config.ts` without downtime

**Monitoring Post-Deployment:**
- Watch `auth.signup` / `auth.signin` event rates (expect non-zero after launch)
- Watch `auth.token.rejected` event rate (alert if >5% of requests)
- Watch `auth.magiclink.expired` rate (alert if >10% — suggests email delivery issues)

---

## Success Criteria

**Feature is complete when:**
- [ ] AC-1 through AC-7 from spec are all verified
- [ ] ≥90% unit test coverage for auth service code
- [ ] All integration tests pass (magic-link flow, expiry, replay, refresh, sign-out)
- [ ] E2E tests pass on staging
- [ ] `OPENAUTH_SIGNING_KEY` removed from all infrastructure and CI
- [ ] `EMAIL_PROVIDER_KEY` added to CI secrets and documented
- [ ] No custom JWKS-fetching code remaining in the codebase
- [ ] Manual testing checklist complete
- [ ] Sign-in success rate ≥95% on staging

---

## Open Questions & Decisions

- **Q1: SST service binding API**
  - **Status:** Pending validation during Phase 1
  - **Resolution:** Try `transform.worker.serviceBindings`; document outcome. HTTP fallback ready if needed.

- **Q2: `client.verify()` in web middleware vs. decode-only `session.ts`**
  - **Status:** Resolved — keep decode-only for v1 (middleware redirect handles expired sessions adequately). Full `client.verify()` in Phase 4 web frontend callback page only.

---

## Related Documents

- **Feature Specification:** `specs/008-openauth-worker/spec.md`
- **Constitution:** `.specify/memory/constitution.md`
- **Task Breakdown:** `specs/008-openauth-worker/tasks.md` (to be created by speckit-tasks)
- **Reference Implementations:**
  - Official issuer example: `anomalyco/openauth/examples/issuer/cloudflare/`
  - Official client example: `anomalyco/openauth/examples/client/cloudflare-api/`
  - Community reference: `mw10013/openauth-wrangler`
