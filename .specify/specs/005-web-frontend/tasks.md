# Task Breakdown: Web Frontend (FitHub v1)

> **Pivot note (2026-05-06):** Web is the v1 user-facing client. Native mobile (and Apple Health) is postponed. Platform OAuth connect/disconnect flows will be defined in `006-zwift-oauth-web` / `007-strava-oauth-web`; this task list links to those flows from the dashboard but does not own the OAuth dance.

---

## Task Breakdown Overview

**Feature:** Web Frontend (FitHub v1)

**Feature ID:** feat-005-web-frontend

**Plan Reference:** `.specify/specs/005-web-frontend/plan.md`

**Breakdown Date:** 2026-05-06

**Status:** Draft

**Total Tasks:** 38

---

## Legend

- `[P]` — task is parallelizable with adjacent tasks (different files, no incomplete dependencies)
- `[US1]` – [US4] — user story phase label (see spec.md user stories)
- `[POSTPONED]` — deferred to mobile v2+ or a future spec

**User Story Map:**

| Label | User Story |
|---|---|
| US1 | As a fitness enthusiast, I want to log in on the web → Auth Gate (AC-1) |
| US2 | As a Zwift/Strava user, I want a dashboard showing connection health → Dashboard (AC-2, AC-3, AC-4, AC-6) |
| US3 | As a user, I want to browse sync history and activity history → Data Views (AC-5, AC-7) |
| US4 | As a privacy-conscious user, I want to manage my data from Settings → Settings (AC-8, AC-10) |

---

## Phase 1: Scaffold & SST Wiring

> **Goal:** `web/` workspace set up; Astro app runs locally via `sst dev`; CI checks pass.
>
> **Independent test:** `sst dev` serves an Astro "hello world" at `localhost:4321`; `astro check`, `tsc --noEmit`, and `eslint` all pass in CI.

- [x] W001 Initialize `web/` workspace member — create `web/package.json` (name: `@fithub/web`), `web/tsconfig.json` (extends root `tsconfig.base.json`), `web/astro.config.mjs` with `@astrojs/cloudflare` adapter, `web/.eslintrc.cjs` extending the shared root ESLint config
- [x] W002 [P] Configure Tailwind CSS v4 inside `web/` — install `tailwindcss`, create `web/tailwind.config.mjs` and `web/src/styles/global.css`; confirm Tailwind utility classes resolve inside Astro `.astro` components
- [x] W003 Add `sst.cloudflare.StaticSite` resource in `sst.config.ts` pointing at `web/` build output; bind the `app.fithub.app` custom domain; verify `sst deploy --stage staging` publishes the static site to Cloudflare Pages
- [x] W004 [P] Add CI steps to `.github/workflows/ci.yml` — `astro check`, `tsc --noEmit`, `eslint web/src`, and `vitest run --project web` run on every PR targeting `main`

---

## Phase 2: Foundational

> **Goal:** Shared types, typed API client, MSW mock setup, and formatters ship — all subsequent phases depend on these.
>
> **Independent test:** `vitest run` — API client unit tests pass; MSW handlers resolve typed fixture responses; formatter snapshot tests pass.

- [x] W005 Export stable API response types from `packages/core/src/types/api.ts` — `AuthUser`, `Connection`, `ConnectionsResponse`, `SyncJob`, `SyncHistoryResponse`, `CanonicalActivity`, `ActivitiesResponse`, `ManualSyncResponse`, `UserProfile`, `ErrorReport`, `ApiError`; bump `@fithub/core` minor version
- [x] W006 Implement typed `fetch` wrapper at `web/src/lib/api-client.ts` — injects `x-correlation-id` header from request context; retries on transient 5xx (max 2 retries, 500ms / 1500ms backoff); normalises all non-2xx responses into `ApiError` with typed `code`; returns typed response per endpoint using types from `@fithub/core`
- [x] W007 [P] Unit-test `web/src/lib/api-client.ts` — success response path, 5xx retry (succeeds on 2nd attempt), exhausted retry → throws `ApiError`, 401 → throws `ApiError` with `AUTH_INVALID_TOKEN` code, assert `x-correlation-id` forwarded on all requests
- [x] W008 [P] Implement formatter utilities at `web/src/lib/formatters.ts` — `formatDuration(s: number): string`, `formatDistance(m: number): string`, `formatRelativeTime(epochS: number): string`, `composeSourceBadges(sources: string[]): string[]`; add snapshot unit tests
- [x] W009 Set up MSW in `web/src/mocks/` — create `web/src/mocks/browser.ts` (service worker), `web/src/mocks/server.ts` (Vitest Node handler), `web/src/mocks/handlers.ts` with handlers for every endpoint in `contracts/openapi.yaml`; wire MSW server into `web/vitest.setup.ts`
- [x] W010 Configure Vitest at `web/vitest.config.ts` — `jsdom` environment, import `web/vitest.setup.ts`, path alias for `@fithub/core`; confirm `vitest run` executes tests in `web/src/**/*.test.ts`

---

## Phase 3: User Story 1 — Authentication (AC-1)

> **Goal:** All non-public routes are auth-gated; unauthenticated visitors are redirected to the Auth Worker and returned to their originally requested URL after sign-in.
>
> **Independent test:** Navigate to `/dashboard` without a session cookie → `302` to `auth.fithub.app/authorize?redirect_uri=...`; submit valid session → land on `/dashboard`.

- [x] W011 [US1] Implement Astro middleware at `web/src/middleware.ts` — check `fithub_session` HttpOnly cookie; redirect unauthenticated requests to `${AUTH_WORKER_URL}/authorize?redirect_uri=<encoded-original-url>`; mint a `correlationId` (UUID v4) and attach to `Astro.locals` for the request lifecycle
- [x] W012 [US1] Implement `web/src/lib/session.ts` — `getSession(cookies): SessionUser | null` decodes the session cookie server-side; define `SessionUser` interface (add to `packages/core/src/types/api.ts` if not present); export `requireSession` helper that calls `getSession` and throws a redirect if null
- [x] W013 [US1] Create login/splash page at `web/src/pages/index.astro` — if session present redirect to `/dashboard`; if not, render minimal splash with "Sign in to FitHub" CTA that links to `${AUTH_WORKER_URL}/authorize`
- [x] W014 [US1] Unit-test auth gate middleware at `web/src/middleware.test.ts` — unauthenticated request redirects with correct target URL; authenticated request passes through with `Astro.locals.user` populated; `redirect_uri` param is URL-encoded and sanitised (no open-redirect vector)

---

## Phase 4: User Story 2 — Dashboard & Connections (AC-2, AC-3, AC-4, AC-6)

> **Goal:** Authenticated users see live connection status, can initiate connect/disconnect, and can trigger a manual sync with real-time feedback.
>
> **Independent test:** Dashboard renders connection cards from `GET /api/connections`; "Sync Now" calls `POST /api/sync/trigger` and shows pending → resolved state (tested against MSW handlers).

- [x] W015 [US2] Build `ConnectionCard` Astro component at `web/src/components/ConnectionCard.astro` — props: `connection: Connection`; renders platform name, status badge (`active`/`requires_reauth`/`disconnected`), `last_synced_at` formatted relative time; "Connect" links to `${AUTH_WORKER_URL}/connect/:platform` (placeholder until 006/007); "Disconnect" calls `DELETE /api/connections/:id`
- [x] W016 [US2] Build `SyncNowButton` island at `web/src/components/SyncNowButton.tsx` — calls `POST /api/sync/trigger`; shows spinner while pending; resolves to ✓ success or ✗ error text inline; re-enables after 30 s; no full-page refresh required
- [x] W017 [US2] Implement dashboard page at `web/src/pages/dashboard.astro` — server-renders using `requireSession`; fetches `GET /api/connections` via `api-client.ts`; renders one `ConnectionCard` per platform; renders empty onboarding state when no connections exist; includes `<SyncNowButton>` island per active connection
- [x] W018 [US2] [P] Implement disconnect action handler — `DELETE /api/connections/:id` called via a form action in `ConnectionCard`; on success, connection row removed from UI without full-page refresh (optimistic update via island)
- [x] W019 [US2] [P] Integration-test dashboard against MSW handlers — renders two connected platforms correctly; renders empty onboarding state; disconnect action fires `DELETE /api/connections/:id`; `SyncNowButton` shows pending then success state

---

## Phase 5: User Story 3 — Sync History & Activity History (AC-5, AC-7)

> **Goal:** Users can browse recent sync jobs and their full deduplicated activity list with source badges.
>
> **Independent test:** Sync history and activity history pages render from MSW fixtures; "Load more" pagination cursor advances correctly; source badges render for multi-platform activities.

- [x] W020 [US3] Implement sync history page at `web/src/pages/sync-history.astro` — fetches `GET /api/sync/history?limit=50` via `api-client.ts` (returning the last 30 days or last 50 jobs, whichever is smaller, per AC-5); renders table of sync jobs: platform, status badge (success/partial/failed), start time, `activities_synced` count, error message (if failed); cursor-based "Load more" button
- [x] W021 [US3] Build `SyncHistoryRow` Astro component at `web/src/components/SyncHistoryRow.astro` — props: `job: SyncJob`; renders columns above; status badge colour-coded (green/amber/red)
- [x] W022 [US3] Implement activity history page at `web/src/pages/activity-history.astro` — fetches `GET /api/activities?limit=50` via `api-client.ts`; renders list with cursor pagination; each row: date, type icon, `formatDuration`, `formatDistance`, source badges from `composeSourceBadges`
- [x] W023 [US3] Build `ActivityRow` Astro component at `web/src/components/ActivityRow.astro` — props: `activity: CanonicalActivity`; renders date, type icon, formatted duration, formatted distance, source badge(s)
- [x] W024 [US3] [P] Add navigation links from dashboard to both history views; add breadcrumb "← Dashboard" on each view
- [x] W025 [US3] [P] Integration-test sync history and activity history pages against MSW — both pages render fixture data; "Load more" passes next `cursor` param; empty state renders when no records

---

## Phase 6: User Story 4 — Settings (AC-8, AC-10)

> **Goal:** Users can view profile info, request a data export, and delete their account with a confirmation step.
>
> **Independent test:** Settings page renders profile from `GET /api/user/profile`; export button calls `POST /api/user/export` and shows confirmation; delete flow shows confirmation modal, calls `DELETE /api/user`, and redirects to logged-out state.

- [x] W026 [US4] Implement settings page at `web/src/pages/settings.astro` — three sections: Profile (email from `GET /api/user/profile`), Data Export, Account Deletion; use `requireSession`; fetch profile server-side via `api-client.ts`
- [x] W027 [US4] [P] Implement data export request island at `web/src/components/ExportButton.tsx` — calls `POST /api/user/export`; on success shows "You'll receive an email when your export is ready" banner; disables button for 24h using `localStorage` to store a cooldown timestamp (no sensitive data stored)
- [x] W028 [US4] Implement account deletion flow — create `web/src/pages/deleted.astro` (logged-out confirmation page with "Your account has been deleted" message and link to landing page); implement `ConfirmDeleteModal` island at `web/src/components/ConfirmDeleteModal.tsx`; requires user to type "DELETE" to confirm; calls `DELETE /api/user`; on success clears session cookie server-side and redirects to `deleted.astro`
- [x] W029 [US4] [P] Integration-test settings page against MSW — profile renders; export button triggers `POST /api/user/export`; delete modal requires "DELETE" confirmation text before enabling submit

---

## Phase 7: Polish & Cross-Cutting Concerns

> **Goal:** All ACs satisfied; Lighthouse ≥90; ≥80% coverage on `api-client.ts` and `formatters.ts`; Playwright E2E green; privacy copy in place; CSP enforced; no third-party scripts on any authenticated route.

- [x] W030 Add error states to every page (`web/src/components/ErrorBanner.astro`) — API unreachable → "We're having trouble connecting, please try again" + retry button; empty states for activity list and sync history; no raw error messages, stack traces, or internal IDs ever rendered (AC-10)
- [x] W031 Implement client-side error reporter at `web/src/lib/error-reporter.ts` — registers `window.onerror` and `window.addEventListener('unhandledrejection')`; maps known HTTP status codes to `ErrorCode` enum from `@fithub/core`; sends `ErrorReport` to `POST /api/errors`; strips cookies, tokens, and PII before sending (Constitution §8)
- [x] W032 Add privacy notice page at `web/src/pages/privacy.astro` — describes session cookie, data collection, retention policy, fitness token storage; no tracking pixels; satisfies Constitution §7
- [x] W033 [P] Add cookie consent banner at `web/src/components/CookieBanner.astro` — "We use a session cookie for authentication only" notice with dismiss; state stored in `sessionStorage`; no third-party consent scripts
- [x] W034 Add sync failure notification banner at `web/src/components/SyncStatusBanner.astro` — polls `GET /api/sync/history?limit=1` every 60 s on the dashboard using `setInterval`; shows an amber banner when latest job is `partial` or `failed`; stop polling on component unmount or when `document.visibilityState === 'hidden'` (use `clearInterval` in cleanup); no WebSockets / SSE (AC resolution from spec.md Q2)
- [x] W035 Write Playwright E2E tests in `web/e2e/` — configure `playwright.config.ts` with three browser projects: `chromium`, `firefox`, `webkit`; happy path: sign in → see dashboard → trigger sync → navigate to activity history → see at least one activity; settings: request export → confirmation visible; account deletion: modal requires "DELETE" → redirect to logged-out page; run all three browsers in CI
- [x] W036 [P] Configure Lighthouse CI and JS bundle size gate — create `lighthouserc.cjs` at repo root; run `lhci autorun` against deployed preview URL (`PAGES_DEPLOYMENT_URL`); assert Performance ≥90 and Best Practices ≥90 on `/dashboard`; add `size-limit` config in `web/package.json` with a ≤200KB budget on the Astro-generated JS for the dashboard route; add both as required checks in `.github/workflows/ci.yml`
- [x] W037 [P] Security hardening — set `Content-Security-Policy` header in `web/src/middleware.ts`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.fithub.app`; verify no third-party scripts load on authenticated routes (Lighthouse Best Practices audit)
- [x] W038 Final verification — run full suite: `vitest run --coverage`, `astro check`, `tsc --noEmit`, `eslint web/src`, Playwright E2E, Lighthouse CI; confirm coverage ≥80% on `web/src/lib/api-client.ts` and `web/src/lib/formatters.ts`; confirm all ACs pass

---

## Coverage Mapping

| Acceptance Criteria | Task(s) |
|---|---|
| AC-1: Auth gate + return redirect | W011, W012, W013, W014 |
| AC-2: Platform status badges | W015, W017 |
| AC-3: Connect platform link | W015 (placeholder link; full flow in 006/007) |
| AC-4: Disconnect platform | W015, W018 |
| AC-5: Sync history view | W020, W021 |
| AC-6: Manual sync trigger + feedback | W016, W017 |
| AC-7: Activity history + source badges | W022, W023 |
| AC-8: Settings (profile, export, delete) | W026, W027, W028 |
| AC-9: Cross-browser / mobile viewport | W035 (Playwright), W036 (Lighthouse) |
| AC-10: No raw errors in UI | W030, W038 |

---

## Dependency Graph

```
W001 ──► W002 [P], W003 [P], W004 [P]
W001 ──► W005 ──► W006 ──► W007 [P]
                         ──► W008 [P]
                         ──► W009 ──► W010
W010 ──► W011 [US1] ──► W012 ──► W013 ──► W014
W006 ──► W015 [US2] ──► W016 ──► W017 ──► W018 [P], W019 [P]
W017 ──► W020 [US3] ──► W021 ──► W022 ──► W023 ──► W024 [P], W025 [P]
W022 ──► W026 [US4] ──► W027 [P], W028 ──► W029 [P]
W028 ──► W030 ──► W031 ──► W032 ──► W033 [P], W034 ──► W035 ──► W036 [P], W037 [P], W038
```

**Critical Path:** W001 → W005 → W006 → W009 → W010 → W011 → W012 → W013 → W015 → W016 → W017 → W020 → W022 → W026 → W028 → W030 → W034 → W035 → W038

---

## Implementation Strategy

**MVP Scope (ship first):** Phases 1–3 + Phase 4 (US1 + US2). Users can log in, see connection health, and trigger a manual sync before the data-view and settings pages are complete.

**Phase 4 unblocks:** Phases 5 and 6 can proceed in parallel once the dashboard (W017) ships.

**Parallel streams available:**
- After W010: US1 (auth gate) and the API client test suite can progress in parallel
- After W017: US3 (data views) and US4 (settings) are fully independent
- Within Phase 7: W033–W034 are independent of each other; W036–W037 are independent of each other

---

## Related Documents

- Spec: `.specify/specs/005-web-frontend/spec.md`
- Plan: `.specify/specs/005-web-frontend/plan.md`
- Research: `.specify/specs/005-web-frontend/research.md`
- Data Model: `.specify/specs/005-web-frontend/data-model.md`
- Contracts: `.specify/specs/005-web-frontend/contracts/openapi.yaml`
- Quickstart: `.specify/specs/005-web-frontend/quickstart.md`
- Constitution: `.specify/memory/constitution.md`
