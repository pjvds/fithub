# Implementation Plan: Web Frontend (FitHub v1)

---

## Plan Overview

**Feature:** Web Frontend — FitHub v1 (Reference: `.specify/specs/005-web-frontend/spec.md`)

**Plan ID:** plan-feat-005-web-frontend

**Version:** 1.0.0

**Date:** 2026-05-06

**Tech Stack:** Astro ^4 + TypeScript ^5.6 + Tailwind CSS ^4 + SST v4 (Ion)
- **Deploy:** `sst.cloudflare.StaticSite` — Cloudflare Pages via SST, same project as backend Workers
- **Testing/tooling:** Vitest ^4 (unit), MSW ^2 (mocked API), Playwright ^1.4x (E2E), Lighthouse CI (perf budget)
- **Shared packages:** `@fithub/core` (shared types, logger, error codes) from `packages/core`
- **Versions verified:** May 2026 — pin minimums in `package.json`; track latest with Renovate/Dependabot

---

## Problem & Approach

**Feature Problem:**
The backend foundation ships APIs that no end user can reach without a client. With native mobile postponed, the v1 product needs a web interface where authenticated users can connect platforms, view their unified activity history, trigger syncs, and manage their account.

**Implementation Approach:**
Build a thin, static-first Astro app inside the existing SST monorepo. Astro's island architecture keeps the initial JS payload small (<200 KB gzip target) and lets interactive islands hydrate on demand. All backend state is owned by the API — the web client is a stateless consumer with no local source of truth beyond an `HttpOnly` session cookie.

Execution is sequenced so the scaffold and auth gate ship first (unblocking all subsequent work), followed by the most user-visible pages (dashboard, activity list), and finishing with polish and cross-cutting concerns (E2E tests, Lighthouse CI, privacy copy).

---

## Design Decisions & Rationale

### Decision 1: Astro as the Web Framework

**Choice:** Astro with island hydration for interactive components; Cloudflare Pages adapter.

**Rationale:**
- Decided 2026-05-06 as part of the mobile pivot; supersedes any prior Flutter Web evaluation
- Static-first rendering (SSG for public pages; SSR with Cloudflare Pages Functions for auth-gated pages) keeps Core Web Vitals strong without sacrificing interactivity
- Island architecture: only the components that need JS hydrate; the rest is zero-JS HTML — ideal for a dashboard with infrequent updates
- Cloudflare Pages adapter is first-party; runs at the edge natively inside the SST deploy

**Constitution Alignment:**
- §3 User Experience — fast initial load; dashboard accessible without heavy JS bundle
- §5 Performance — island granularity + static shell hits the ≤200 KB budget easily

**Alternatives Considered:**
- Next.js: heavier runtime, more complex edge config, larger default JS bundle
- SvelteKit: excellent, but team lacks existing expertise; Astro integrates more naturally with a zero-JS-first philosophy
- Remix: good routing model but no Cloudflare-native static export

**Impact:** New workspace member `web/` with Astro project scaffold; add Cloudflare Pages adapter and `sst.cloudflare.StaticSite` resource.

---

### Decision 2: Session via HttpOnly Cookie (No localStorage)

**Choice:** After the Auth Worker issues a JWT, the web app receives it via a redirect and stores it in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie scoped to the apex domain (`fithub.space`). All subsequent API calls carry the cookie automatically; no JS token storage.

**Rationale:**
- `HttpOnly` prevents XSS from reading the token
- `SameSite=Lax` mitigates CSRF without requiring a separate CSRF token for safe-method requests
- Apex-scoped cookie allows `app.fithub.space` (web) and `auth.fithub.space` (Auth Worker) to share the session without cross-domain fetch complexity
- Zero fitness data or tokens ever touch `localStorage` or `sessionStorage`

**Constitution Alignment:**
- §1 Data Privacy — No sensitive token reachable from JS context
- §3 User Experience — Transparent to the user; works without extra client state management

**Alternatives Considered:**
- Bearer token in memory + refresh flow: requires JS state on every navigation; breaks on hard reload
- `localStorage` token: vulnerable to XSS; explicitly prohibited by Constitution §1

**Impact:** Requires the Auth Worker callback to set the cookie rather than return the JWT in the URL fragment; web app must read session info from an authenticated `GET /api/me` call on first load.

---

### Decision 3: Typed API Client from `@fithub/core`

**Choice:** A thin `fetch` wrapper at `web/src/lib/api-client.ts` using request/response types exported from `packages/core`. No SDK generation — types are imported directly from the shared workspace package.

**Rationale:**
- Shared types means a backend breaking change produces a TypeScript compile error in the web app before reaching runtime
- A hand-written `fetch` wrapper stays small and transparent; no third-party HTTP client dependency
- The wrapper adds: retry on transient 5xx (max 2 retries, 500ms/1500ms backoff), `x-correlation-id` header forwarding (Constitution §8), and standard error normalisation into a typed `ApiError`

**Constitution Alignment:**
- §6 Code Quality — Single source of type truth; breaks detected at compile time
- §8 Functional & Structured Logging — Correlation ID propagated on every request

**Alternatives Considered:**
- Generate SDK from OpenAPI spec: adds tooling complexity; types would diverge from Core types
- Axios: unnecessary; native `fetch` + retry wrapper is simpler and has no bundle cost

**Impact:** `packages/core` must export stable, versioned API response types. Minor changes to `packages/core/src/types/api.ts` needed for types currently unexported.

---

### Decision 4: MSW for Mocked API Development

**Choice:** [Mock Service Worker](https://mswjs.io/) (MSW) in the browser and Vitest environment to intercept `fetch` calls with fixture responses during development and integration testing.

**Rationale:**
- Allows web development to proceed against realistic mock data while backend endpoints ship
- Same MSW handlers work in both the browser dev server and in Vitest — no duplicated mock setup
- Playwright E2E tests run against the real deployed preview environment (no MSW there)

**Constitution Alignment:**
- §6 Code Quality — Fixtures tested at integration layer catch API contract drift early

**Alternatives Considered:**
- Dedicated mock server (json-server): extra process to manage; harder to keep in sync with types
- Hard-coded data in components: pollutes production code; removed type safety

**Impact:** Add `msw` dev-dependency; create `web/src/mocks/` directory with handlers per endpoint; wired into Vitest setup file.

---

### Decision 5: Lighthouse CI for Performance Budget Enforcement

**Choice:** Run `lhci autorun` in CI on the authenticated dashboard route (using a seeded test account against the deployed preview environment). Enforce score ≥90 for Performance and Best Practices. Fail the PR if either budget is breached.

**Rationale:**
- Constitution §5 requires performance regression tests in CI
- Lighthouse scores reflect real user experience metrics (LCP, TBT, CLS) that matter for a dashboard app
- Enforcing the budget at PR time prevents gradual regression

**Constitution Alignment:**
- §5 Performance — Regression tests in CI
- §3 User Experience — Fast dashboard load is a direct UX quality gate

**Alternatives Considered:**
- Manual perf review: unreliable; no enforcement
- Bundle size check only: misses runtime perf (e.g., render blocking, layout shifts)

**Impact:** Add `@lhci/cli` as dev dependency; add `lighthouserc.cjs` config file; Cloudflare Pages preview URL inferred from `PAGES_DEPLOYMENT_URL` CI env var.

---

### Decision 6: Principle 8 — Structured Logging via Shared Logger

**Choice:** Server-side Astro endpoints and middleware import `@fithub/core/logging` and emit structured JSON logs identical to the Workers. Client-side JavaScript errors are reported to a backend ingest endpoint (`POST /api/errors`) which re-emits them through the logger.

**Rationale:**
- Constitution §8 requires all services to emit structured, functional logs — this applies to Astro's server-side layer
- Client-side console errors should feed the same observability pipeline, not disappear silently
- A shared `ErrorCode` enum lets browser-side errors be mapped to typed codes before sending

**Constitution Alignment:**
- §8 Functional & Structured Logging — Web client participates in the same structured log stream as Workers

**Impact:** Astro middleware at `web/src/middleware.ts` attaches a `correlationId` to every request and creates a scoped logger; all server endpoints use this logger, not `console.*`.

---

## Architecture & Component Changes

```
web/                         ← new workspace member
  src/
    pages/                   ← Astro pages (SSR/static)
      index.astro            ← landing / login redirect
      dashboard.astro        ← platform connections + sync status
      activity-history.astro ← canonical activity list
      sync-history.astro     ← sync job log
      settings.astro         ← profile, export, delete
    components/              ← Astro + TSX island components
      ConnectionCard.*       ← per-platform status card
      ActivityRow.*          ← activity list row
      SyncHistoryRow.*       ← sync history row
      SyncNowButton.*        ← manual sync island
    lib/
      api-client.ts          ← typed fetch wrapper (Decision 3)
      session.ts             ← cookie session helpers
      formatters.ts          ← duration, distance, date formatters
    middleware.ts            ← auth gate + correlation ID + logger (Decision 6)
    mocks/                   ← MSW handlers (dev + test only)
  astro.config.mjs
  tailwind.config.mjs
  tsconfig.json              ← extends root base
```

**New SST Resource:** `sst.cloudflare.StaticSite` in `sst.config.ts` pointing to `web/` build output, attached to `app.fithub.space`.

**Modified components in backend:**
- `packages/core/src/types/api.ts` — export stable response types used by the web API client
- `packages/functions/src/api/routes/auth.ts` — confirm `GET /api/me` endpoint exists (session info); add if absent

---

## Principle 8 Compliance (Functional & Structured Logging)

All web server-side code MUST:
- Import and use `@fithub/core/logging` (the shared logger) — no bare `console.*` in server code
- Attach `correlationId` via `web/src/middleware.ts` for every request
- Emit functional event names (e.g., `web.dashboard.loaded`, `web.sync.triggered`, `web.auth.redirect`)
- Forward `x-correlation-id` on all outgoing API client requests
- Never log cookies, session tokens, or PII
- Report client-side errors to `POST /api/errors` with a typed `ErrorCode` from the shared enum

---

## Implementation Phases

### Phase 1 — Scaffold & SST Wiring

Set up `web/` workspace, Astro project, Tailwind, TypeScript config extending root, and SST `StaticSite` resource. Confirm `sst dev` serves the web app locally and `sst deploy` publishes to Cloudflare Pages.

**Deliverable:** Empty Astro app accessible at `app.fithub.space` in staging.

---

### Phase 2 — Auth Gate

Implement Astro middleware that checks for a valid session cookie and redirects unauthenticated requests to the Auth Worker's authorize endpoint. Post-auth redirect must return the user to their originally requested page.

**Deliverable:** Any protected route redirects to Auth Worker; after sign-in, user lands on `/dashboard`.

---

### Phase 3 — API Client + Mocked Dashboard

Build the typed API client (`web/src/lib/api-client.ts`) and set up MSW handlers for all dashboard endpoints. Render the dashboard against mocked data so layout and component work can proceed before backend ships.

**Deliverable:** Dashboard renders (with mocked data), compiles cleanly, and passes lint/typecheck in CI.

---

### Phase 4 — Dashboard (Real API)

Wire dashboard page to real `GET /api/connections` and `GET /api/sync/latest` endpoints. Implement `ConnectionCard` with status badge and last-sync time. Implement `SyncNowButton` island calling `POST /api/sync/trigger`.

**Deliverable:** AC-2, AC-3, AC-4, AC-6 satisfied against real API.

---

### Phase 5 — Sync History & Activity History

Implement `sync-history` page (`GET /api/sync/history`) and `activity-history` page (`GET /api/activities`). Activity rows show source badges (Zwift / Strava).

**Deliverable:** AC-5, AC-7 satisfied.

---

### Phase 6 — Settings

Implement settings page: profile view (`GET /api/user/profile`), export request (`POST /api/user/export`), and account deletion (`DELETE /api/user`) with confirmation modal.

**Deliverable:** AC-8 satisfied.

---

### Phase 7 — Polish & Cross-Cutting Concerns

- Error states for every page (empty state, API error, retry affordance)
- Privacy notice page and cookie consent banner
- Error reporter island sending client-side errors to `POST /api/errors`
- Playwright E2E tests (happy path + settings)
- Lighthouse CI in GitHub Actions pipeline
- Unit tests for API client, formatters, auth gate
- `astro check` + ESLint + TypeScript strict in CI

**Deliverable:** All ACs passing; Lighthouse ≥90; ≥80% coverage on `api-client.ts` and `formatters.ts`.

---

## Open Questions for Future Features

- OAuth connect/disconnect flows for Zwift and Strava will be defined in `006-zwift-oauth-web` / `007-strava-oauth-web`; web frontend links to those flows and consumes their results, but does not own the OAuth dance
- Account linking (same email via Apple + Google) is a backend concern — no web-side work needed until Auth Worker spec covers it

---

## Related Documents

- Spec: `.specify/specs/005-web-frontend/spec.md`
- Constitution: `.specify/memory/constitution.md`
- Architecture Overview: `.specify/memory/architecture-overview.md`
- Backend Foundation Plan: `.specify/specs/000-backend-foundation/plan.md`
- Task Breakdown: `.specify/specs/005-web-frontend/tasks.md`
