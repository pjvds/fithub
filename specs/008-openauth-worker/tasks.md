# Task Breakdown: FitHub User Authentication

**Feature:** FitHub User Authentication

**Feature ID:** feat-008-openauth-worker

**Plan Reference:** `specs/008-openauth-worker/plan.md`

**Breakdown Date:** 2026-05-07

**Breakdown Author:** speckit-tasks

**Status:** Approved

---

## Task Summary

**Total Tasks:** 27

**Critical Path:** Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 (sequential)

**Parallel Opportunities:** 8 tasks marked [P] — up to 3 parallel work streams within Phases 2, 3, and 6

**Priority Tasks (unblock others):**
1. T001/T002 — Package dep and shared subjects (unblock everything)
2. T003 — SST infrastructure (unblock auth worker and API migration)
3. T008–T010 — Auth worker core (unblock web frontend and E2E tests)
4. T005/T006 — API middleware migration (unblock API token verification)

**MVP Scope (User Story 1 only):** T001–T012 + T020

---

## Legend

- 🔐 **Data Privacy & Security**
- 👤 **User Experience & Simplicity**
- ✅ **Reliability & Uptime**
- ⚡ **Performance & Real-Time Sync**
- 🧪 **Code Quality & Testing**
- 📢 **Transparency & Communication**
- 🔧 **Infrastructure**

---

## Phase 1: Setup (no dependencies)

> Install new dependencies and create the shared module that all three workers must import.

**Independent test criteria:** `subjects.ts` exports `subjects`; TypeScript compiles without errors across all three packages.

- [ ] T001 🔧 Add `@openauthjs/openauth` to `web/package.json` and run `pnpm install` in `web/`
- [ ] T002 🔧 Create shared token subjects module at `packages/functions/src/shared/subjects.ts` — export `subjects = createSubjects({ user: object({ id: string() }) })` using valibot validators from `@openauthjs/openauth/subject`

---

## Phase 2: Infrastructure & Foundation (depends on Phase 1)

> SST infrastructure, API middleware migration, and CI secrets. All user story phases depend on this phase completing.

**Independent test criteria:** `sst build` succeeds without errors; TypeScript compiles in `packages/functions`; CI workflow references correct secrets.

- [ ] T003 🔧 Update `sst.config.ts` — remove `openauthSigningKey` Secret and all its references; add `emailProviderKey = new sst.Secret("EMAIL_PROVIDER_KEY")`; declare `auth = new sst.cloudflare.Worker("Auth", { handler: "packages/functions/src/auth/index.ts", link: [authKv, db, emailProviderKey], url: true })`; update web `environment.AUTH_WORKER_URL` to `auth.url`; add `link: [auth]` to web declaration; add Auth service binding to API Worker via `transform.worker.serviceBindings`
- [ ] T004 [P] 🔧 Create `web/src/lib/auth-client.ts` — export `createAuthClient()` factory that returns `createClient({ issuer: import.meta.env.AUTH_WORKER_URL })` from `@openauthjs/openauth/client`; used by callback page, logout page, and middleware. **Note:** In Astro SSR on Cloudflare Pages, the `Auth` service binding is accessed via `context.locals.runtime.env.Auth` (not `import.meta.env`); the client factory must accept an optional `fetch` override so the service binding can be passed from server-side contexts.
- [ ] T005 [P] 🔐 Rewrite `packages/functions/src/api/middleware/auth.ts` — replace all 169 lines of custom JWKS-fetching code with `@openauthjs/openauth/client`; preserve exported `authMiddleware(opts: { client: ReturnType<typeof createClient> })` signature and `AuthVariables` interface; middleware calls `client.verify(subjects, token)` and sets `c.set("userId", props.properties.id)`; keep existing structured log events (`auth.token.accepted`, `auth.token.rejected`) and `ErrorCode` mappings
- [ ] T006 🔧 Update `packages/functions/src/api/index.ts` — import `createClient` from `@openauthjs/openauth/client`; initialise client with `issuer: Resource.Auth.url` and service binding `fetch: (input, init, ...rest) => { const headers = new Headers((init as RequestInit)?.headers); const reqId = (input instanceof Request ? input.headers.get("x-request-id") : null) ?? (init as RequestInit | undefined)?.headers?.["x-request-id"]; if (reqId) headers.set("x-request-id", reqId); return (env as any).Auth.fetch(input, { ...init, headers }); }`; pass client to `authMiddleware({ client })`; remove `OPENAUTH_JWKS_URL` fallback reference. **Correlation IDs:** the fetch override must propagate the incoming `X-Request-ID` header to all auth worker calls so cross-service traces are linked. **Acceptance criterion:** validate that `client.verify()` completes in <10ms p95 in Worker metrics (use Cloudflare dashboard or wrangler tail to confirm; document baseline in PR description)
- [ ] T007 🔧 Update `.github/workflows/ci.yml` — replace `OPENAUTH_SIGNING_KEY` with `EMAIL_PROVIDER_KEY` in the secrets seed step; verify no other references to `OPENAUTH_SIGNING_KEY` remain

---

## Phase 3: User Story 1 — Email Sign-In & Account Creation (depends on Phase 2)

> **US1:** As a new visitor, I want to create a FitHub account using my email address.
> **Covers:** AC-1 (magic-link sign-in), AC-2 (redirect to dashboard), AC-5 (auto account creation), AC-6 (single-tab flow), AC-7 (token verification endpoint)

**Independent test criteria:** A new email address can complete the full magic-link flow end-to-end and arrive at `/dashboard`; the FithubDb `users` table gains a new row; a subsequent API call with the issued token returns 200.

- [ ] T008 [P] 🔐 Create `packages/functions/src/auth/index.ts` — `export default { async fetch(request, env, ctx) { return issuer({ storage: CloudflareStorage({ namespace: env.AuthKv }), subjects, providers: { code: CodeProvider(CodeUI({ sendCode })) }, success }).fetch(request, env, ctx) } }`; import `subjects` from shared module; wire `env` type with `AuthKv: KVNamespace`, `FithubDb: D1Database`, `EMAIL_PROVIDER_KEY: string`. **Correlation IDs:** Generate a `X-Request-ID` header (uuid) for every request if not already present; forward it in all downstream fetch calls and include it in every structured log event (`requestId` field)
- [ ] T009 [P] 📢 Implement `sendCode` in auth worker — stage detection: use `(env.ENVIRONMENT ?? Resource.App?.stage ?? "development") === "production"` (`env.ENVIRONMENT` is the Cloudflare-native env var available in both `wrangler dev` and deployed workers; `Resource.App.stage` is only available post-SST-deploy); on production: send email via Resend SDK using `env.EMAIL_PROVIDER_KEY`; template: subject "Your FitHub sign-in code", plain + HTML body with code and 15-minute expiry warning; on all other stages: `console.log("[DEV] FitHub OTP for", email, "→", code)` (email address must NOT appear in production logs). **Logging:** emit `auth.magiclink.sent` structured log event with `{ requestId, userId: null, stage }` after successful send (on error: emit `auth.magiclink.send_failed` with error code, NO email address)
- [ ] T010 🔐 Implement `success` callback in auth worker — extract `value.claims.email as string`; query `FithubDb` for existing user by email via Drizzle; if not found: insert new user with `crypto.randomUUID()` as id; return `ctx.subject("user", { id: user.id })`; emit `auth.signup` log event (userId only) on creation, `auth.signin` on returning sign-in
- [ ] T011 👤 Create `web/src/pages/auth/callback.astro` — SSR page; extract `code` + `state` from `Astro.url.searchParams`; call `client.exchange(redirectUri, Astro.url.toString())`; on success: set `access_token` cookie (HttpOnly, Secure, SameSite=Strict, path=/, maxAge=86400) and `refresh_token` cookie (HttpOnly, Secure, SameSite=Strict, path=/auth, maxAge=2592000); redirect to `/dashboard` (or decoded `redirect_uri` from state); on error: if error indicates expired code emit `auth.magiclink.expired` structured log event (with `requestId`, no PII), then redirect to `/?error=auth_failed`
- [ ] T012 🔐 Update `web/src/middleware.ts` — replace decode-only `getSession()` with `createAuthClient().verify(subjects, access_token_cookie_value)` for protected routes; on `InvalidTokenError`: attempt refresh (Phase 4); on failure: redirect to `${import.meta.env.AUTH_WORKER_URL}/authorize?redirect_uri=...`; set `locals.user = { userId: result.subject.properties.id }` on success. **Correlation IDs:** extract `X-Request-ID` from `Astro.request.headers` (or generate a new uuid if absent); pass it as a header override when constructing the auth client so it is forwarded on verify/exchange calls: `createAuthClient({ fetch: (input, init) => fetch(input, { ...init, headers: { ...(init?.headers ?? {}), "x-request-id": requestId } }) })`

---

## Phase 4: User Story 2 — Session Persistence (depends on Phase 3)

> **US2:** As a signed-in user, I want my session to persist across browser restarts.
> **Covers:** AC-3 (30-day persistence without re-authentication)

**Independent test criteria:** After closing and reopening the browser, a user with a valid session cookie is redirected to `/dashboard` without being asked to sign in again; access token expiry triggers silent refresh (visible only in cookies, not to the user).

- [ ] T013 ✅ Update `web/src/middleware.ts` — add silent token refresh branch: when `verify()` throws due to expired access token and a `refresh_token` cookie is present, call `client.verify(subjects, access_token, { refresh: refresh_token })`; if refresh succeeds: overwrite `access_token` cookie with new token value; if refresh fails (token revoked or expired): clear both cookies and redirect to sign-in
- [ ] T014 ✅ Update `web/src/pages/auth/callback.astro` — set explicit `maxAge` on both cookies: `access_token` 86400 (24h), `refresh_token` 2592000 (30d); confirm `Secure` and `SameSite=Strict` flags are set on both; add comment explaining why no cookie signing is needed

---

## Phase 5: User Story 3 — Secure Sign-Out (depends on Phase 3)

> **US3:** As a signed-in user, I want to sign out securely so others cannot access my account.
> **Covers:** AC-4 (immediate session invalidation, subsequent requests rejected)

**Independent test criteria:** After visiting `/auth/logout`, the session cookies are cleared; a direct visit to `/dashboard` redirects to sign-in; a previously valid access token is rejected by the API worker.

- [ ] T015 🔐 Create `web/src/pages/auth/logout.astro` — SSR page; read `refresh_token` cookie value; call `POST {AUTH_WORKER_URL}/invalidate` with `{ refresh_token }` body; on success: emit `auth.signout` structured log event `{ requestId, userId: locals.user?.userId }`; clear `access_token` cookie (maxAge=0) and `refresh_token` cookie (maxAge=0); redirect to `/`; handle `fetch` errors gracefully (still clear cookies even if invalidate call fails)
- [ ] T016 👤 Add sign-out link to `web/src/layouts/Layout.astro` (or the authenticated nav component) — render `<a href="/auth/logout">Sign out</a>` only when `locals.user` is set; ensure it is keyboard-accessible and visible in the navigation

---

## Phase 6: Testing & Polish (depends on Phases 3–5)

> Cross-cutting: tests, logging completeness, documentation updates.

**Independent test criteria:** All unit and integration tests pass in CI; test coverage ≥90% for auth worker code; manual testing checklist complete.

- [ ] T017 [P] 🧪 Write unit tests for `packages/functions/src/shared/subjects.ts` — validate correct subject shape accepted, incorrect shape rejected, `verify()` output matches expected `{ type: "user", properties: { id: string } }`
- [ ] T018 [P] 🧪 Write unit tests for auth worker `success` callback (in `packages/functions/src/auth/index.test.ts`) — test: existing user looked up by email, new user created with UUID, `AUTH_MISSING_TOKEN`-equivalent error on missing provider match, `value.claims.email` extraction
- [ ] T019 [P] 🧪 Rewrite unit tests for `packages/functions/src/api/middleware/auth.ts` — update/replace the existing 18-test suite: valid token → userId set, expired token → 401, missing token → 401, malformed token → 401, wrong issuer → 401; mock `client.verify()` responses; **add test:** `X-Request-ID` header propagated from incoming request to auth worker verify call (correlation ID assertion)
- [ ] T020 🧪 Write integration test for full magic-link flow — mock `sendCode` to capture the code; POST to `/authorize`; submit code to `/callback`; assert tokens returned; make API request with token; assert 200 with correct `userId`
- [ ] T021 [P] 🧪 Write integration tests for error and edge cases — expired OTP (>15min): callback returns error; replay attack (code used twice): second use rejected; expired refresh token: POST /token returns 401; invalidated session: API call returns 401 after /invalidate
- [ ] T022 [P] 🧪 Write E2E test for new user sign-in — start on `/`; redirect to `/authorize`; submit email; enter console-logged code; assert arrival at `/dashboard`; assert `users` table has new row
- [ ] T023 [P] 🧪 Write E2E test for returning user and sign-out — sign in; close + reopen browser (simulate via cookie persistence); assert `/dashboard` accessible without re-auth; click sign-out; assert redirect to `/`; assert `/dashboard` redirects to sign-in
- [ ] T024 📢 Update `specs/006-cicd-deploy-pipeline/spec.md` secret inventory — remove `OPENAUTH_SIGNING_KEY` entry; add `EMAIL_PROVIDER_KEY` entry with description "Resend API key for magic-link email delivery (auth worker only)"; confirm net total remains 5 SST app secrets
- [ ] T025 📢 Update `web/src/pages/index.astro` (sign-in page) — add privacy policy link (`<a href="/privacy">Privacy Policy</a>`) below the sign-in CTA; required for future Apple Sign-In compliance; add error display for `?error=auth_failed` query param

---

## Task Dependency Graph

```
T001 ──────────────────────────────────────────────────────────────────► T002
T001 + T002 ────────────────────────────────────────────────────────────► T003
                                                                           │
          ┌────────────────────┬───────────────┬───────────────┬──────────┘
          ↓                    ↓               ↓               ↓
         T004 [P]            T005 [P]         T006            T007
    (auth-client.ts)    (api/auth.ts rewrite) (api/index.ts)  (CI secrets)
          │                    │               │
          │                    └───────────────┘ (T006 depends on T005)
          │
          ↓  (all Phase 2 complete)
T008 [P] + T009 [P] + T010   (auth worker — T010 depends on T008)
          │
         T011   (callback page — depends on T004, T008-T010)
          │
         T012   (middleware verify — depends on T004, T011)
          │
    ┌─────┤
    ↓     ↓
  T013   T014   (session persistence — both depend on T011/T012)
    │
    ↓
  T015   (logout page)
    │
  T016   (nav sign-out link)
    │
    ↓  (all implementation complete)
T017[P] T018[P] T019[P] T020 T021[P] T022[P] T023[P] T024 T025
```

---

## Parallel Execution: Quick Reference

Work that can proceed simultaneously once prerequisites are met:

**After T002 (shared subjects ready) + T003 (SST infra):**
- Stream A: T004 → T005 → T006 (web auth client + API middleware)
- Stream B: T008 → T009 → T010 (auth worker implementation)

**After Phase 3 complete:**
- T013, T014 can be done together (both modify callback + middleware)
- T015, T016 independent of T013/T014

**After Phase 5 complete:**
- T017, T018, T019, T021, T022, T023 all parallelizable
- T020 must run after T008–T011 (needs full flow)
- T024, T025 are documentation — can be done any time after Phase 5

---

## Implementation Strategy (MVP First)

**MVP (User Story 1 only — sign in works end-to-end):**
T001 → T002 → T003 → [T004+T005+T008+T009] → T006+T010 → T011 → T012 → T020

After MVP: add session persistence (T013–T014), then sign-out (T015–T016), then full test suite (T017–T025).

---

## Quick Reference Checklist

**Phase 1 — Setup:**
- [ ] T001 — Add openauth to web package.json
- [ ] T002 — Create shared/subjects.ts

**Phase 2 — Infrastructure:**
- [ ] T003 — Update sst.config.ts (full auth infra)
- [ ] T004 — Create web/src/lib/auth-client.ts
- [ ] T005 — Rewrite api/middleware/auth.ts
- [ ] T006 — Update api/index.ts
- [ ] T007 — Update CI workflow secrets

**Phase 3 — US1 (sign-in):**
- [ ] T008 — Create auth/index.ts (issuer scaffold)
- [ ] T009 — Implement sendCode (Resend / console.log)
- [ ] T010 — Implement success callback (user lookup/create)
- [ ] T011 — Create auth/callback.astro
- [ ] T012 — Update web/src/middleware.ts (verify)

**Phase 4 — US2 (persistence):**
- [ ] T013 — Add silent refresh to middleware
- [ ] T014 — Confirm cookie maxAge/flags in callback

**Phase 5 — US3 (sign-out):**
- [ ] T015 — Create auth/logout.astro
- [ ] T016 — Add sign-out link to layout

**Phase 6 — Testing & Polish:**
- [ ] T017 — Unit tests: subjects.ts
- [ ] T018 — Unit tests: auth worker success callback
- [ ] T019 — Unit tests: api/middleware/auth.ts (replace 18 tests)
- [ ] T020 — Integration: full magic-link flow
- [ ] T021 — Integration: error/edge cases
- [ ] T022 — E2E: new user sign-in
- [ ] T023 — E2E: returning user + sign-out
- [ ] T024 — Docs: update secret inventory in feat-006
- [ ] T025 — Docs: privacy policy link + error state on sign-in page

---

## Related Documents

- **Feature Specification:** `specs/008-openauth-worker/spec.md`
- **Implementation Plan:** `specs/008-openauth-worker/plan.md`
- **Data Model:** `specs/008-openauth-worker/data-model.md`
- **API Contracts:** `specs/008-openauth-worker/contracts/auth-api.md`
- **Research:** `specs/008-openauth-worker/research.md`
- **Constitution:** `.specify/memory/constitution.md`
