# Task Breakdown: Web Frontend (FitHub v1)

> **Pivot note (2026-05-06):** Web is the v1 user-facing client. Native mobile (and therefore Apple Health + push notifications) is postponed. This task list covers only the web frontend; platform OAuth web flows (Zwift, Strava connect/disconnect) will be defined in future `006-*` / `007-*` features and linked from the dashboard.

---

## Task Breakdown Overview

**Feature:** Web Frontend (FitHub v1)

**Feature ID:** feat-005-web-frontend

**Plan Reference:** `.specify/specs/005-web-frontend/plan.md`

**Breakdown Date:** 2026-05-06

**Status:** Draft

---

## Legend

- 🔐 Data Privacy & Security
- 🔗 Cross-Platform Integration
- 👤 User Experience & Simplicity
- ✅ Reliability & Uptime
- ⚡ Performance & Real-Time Sync
- 🧪 Code Quality & Testing
- 📢 Transparency & Communication
- `[P]` — can be done in parallel with adjacent tasks
- `[POSTPONED]` — deferred to mobile v2+

---

## Phase 1: Scaffold & SST Wiring

> **Goal:** `web/` workspace set up; Astro app running locally via `sst dev` and deployable to Cloudflare Pages via SST.
>
> **Independent test:** `sst dev` serves an Astro "hello world" page; `astro check` + ESLint + typecheck all pass in CI.

- [ ] W001 🧪 Add `web/` workspace member to the SST monorepo — create `web/package.json`, `web/tsconfig.json` (extends root `tsconfig.base.json`), `web/astro.config.mjs` with the Cloudflare Pages adapter, `web/.eslintrc.cjs` extending the shared root config
- [ ] W002 [P] 🧪 Install and configure Tailwind CSS v4 inside `web/` — `tailwind.config.mjs`, `web/src/styles/global.css`; confirm Tailwind classes resolve in Astro components
- [ ] W003 🧪 Add `sst.cloudflare.StaticSite` resource in `sst.config.ts` pointing at the `web/` build output; bind the `app.fithub.app` custom domain; verify `sst deploy --stage staging` publishes the page
- [ ] W004 [P] 🧪 Add CI steps — `astro check`, `tsc --noEmit`, `eslint web/src`, and `vitest run --project web` — to the existing GitHub Actions workflow so they run on every PR

---

## Phase 2: Auth Gate

> **Goal:** Any authenticated route redirects unauthenticated visitors to the Auth Worker; after sign-in, the user returns to the originally requested URL.
>
> **Independent test:** Navigate to `/dashboard` without a session → redirected to `auth.fithub.app/authorize`; complete sign-in → land on `/dashboard`.

- [ ] W005 🔐 Implement `web/src/middleware.ts` — check for valid `fithub_session` `HttpOnly` cookie; redirect unauthenticated requests to `${AUTH_URL}/authorize?redirect_uri=<original>` preserving the target path; attach a `correlationId` (UUID v4) to every request context
- [ ] W006 🔐 Implement `web/src/lib/session.ts` — decode the session cookie to extract `userId` and display name for server-rendered pages; expose a typed `SessionUser` interface from `@fithub/core` (add if not yet exported)
- [ ] W007 🧪 Unit-test the auth gate middleware — unauthenticated requests redirect correctly; cookie present → user context available; redirect target URL is correctly preserved and sanitised (no open-redirect vector)

---

## Phase 3: API Client + Mocked Dashboard

> **Goal:** Typed API client ships; mocked dashboard renders against MSW fixtures; all tests and CI checks pass.
>
> **Independent test:** Run `vitest` — API client unit tests pass; dashboard integration test renders against MSW handlers.

- [ ] W008 🧪 Export stable API response types from `packages/core/src/types/api.ts` — `ConnectionStatus`, `SyncJob`, `CanonicalActivity`, `UserProfile` (add any types not yet exported); bump `@fithub/core` minor version
- [ ] W009 🔗 Implement `web/src/lib/api-client.ts` — thin `fetch` wrapper that: injects `x-correlation-id` header from request context; retries on transient 5xx (max 2 retries, 500ms / 1500ms backoff); normalises all non-2xx responses into a typed `ApiError`; returns typed response shape per endpoint
- [ ] W010 [P] ✅ Unit-test `api-client.ts` — success response, 5xx retry (succeeds on 2nd attempt), exhausted retry → throws `ApiError`, 401 → throws `ApiError` with `AUTH_INVALID_TOKEN` code; test that `x-correlation-id` is forwarded
- [ ] W011 🧪 Set up MSW in `web/src/mocks/` — browser service worker (`msw/browser`) and Vitest server handler (`msw/node`); create fixture handlers for: `GET /api/connections`, `GET /api/sync/latest`, `GET /api/activities`, `GET /api/sync/history`, `GET /api/auth/me`; wire MSW into Vitest setup file
- [ ] W012 👤 Build dashboard page skeleton at `web/src/pages/dashboard.astro` — server-rendered shell using MSW fixtures; renders a `ConnectionCard` stub per platform returned by `GET /api/connections`; page is behind auth gate

---

## Phase 4: Dashboard (Real API)

> **Goal:** Dashboard renders live data from the backend; connect/disconnect links wired; "Sync now" works.
>
> **Acceptance Criteria:** AC-2 (platform status badges), AC-3 (connect flow link), AC-4 (disconnect action), AC-6 (manual sync trigger + feedback)
>
> **Independent test:** Real backend connected → dashboard shows correct connection status; Sync now button triggers sync; status updates on next poll.

- [ ] W013 👤 Implement `ConnectionCard` Astro component — shows platform name, status badge (connected / degraded / disconnected), last-sync timestamp; "Connect" button links to the future `/connect/:platform` flow (placeholder href for now); "Disconnect" button calls `DELETE /api/connections/:platform`
- [ ] W014 👤 Wire `dashboard.astro` to real `GET /api/connections` and `GET /api/sync/latest` endpoints (remove MSW handler override); handle empty state (no connections yet) with an onboarding prompt
- [ ] W015 👤 Implement `SyncNowButton` island (`web/src/components/SyncNowButton.tsx`) — calls `POST /api/sync/trigger`; shows spinner while pending; resolves to success tick or error message within the button; no full-page refresh
- [ ] W016 [P] ✅ Integration-test the dashboard against MSW handlers — renders with two connected platforms; renders empty state; disconnect action fires the correct API call; sync button shows pending then success state

---

## Phase 5: Sync History & Activity History

> **Goal:** Users can browse recent sync jobs and their activity history.
>
> **Acceptance Criteria:** AC-5 (sync history), AC-7 (activity history with source badges)

- [ ] W017 👤 Implement `web/src/pages/sync-history.astro` — server-rendered list of recent sync jobs from `GET /api/sync/history`; columns: platform, status badge (success / partial / failed), start time, activities added/merged; paginates at 50 per page
- [ ] W018 👤 Implement `web/src/pages/activity-history.astro` — server-rendered activity list from `GET /api/activities` with cursor-based pagination; each row: date, activity type icon, duration, distance, source badges (e.g., "Zwift + Strava")
- [ ] W019 [P] 🧪 Unit-test formatter functions (`web/src/lib/formatters.ts`) — `formatDuration`, `formatDistance`, `formatRelativeTime`, `composeSourceBadges`; snapshot tests for rendered badge combinations
- [ ] W020 [P] 👤 Add navigation links from the dashboard to both history views; add a "Back to dashboard" breadcrumb on each view

---

## Phase 6: Settings

> **Goal:** Users can view their profile, request a data export, and delete their account.
>
> **Acceptance Criteria:** AC-8

- [ ] W021 👤 Implement `web/src/pages/settings.astro` — three sections: Profile (display name, email from `GET /api/auth/me`), Data Export (`POST /api/export`), Account Deletion (`DELETE /api/account`)
- [ ] W022 🔐 Implement account-deletion flow — confirmation modal island (`ConfirmDeleteModal.tsx`); calls `DELETE /api/account`; on success redirects to a logged-out "Account deleted" page and clears the session cookie
- [ ] W023 [P] 👤 Implement data-export request — calls `POST /api/export`; shows a success banner ("You'll receive an email when your export is ready") and disables the button for 24h (using a `localStorage` timestamp — the one acceptable use of `localStorage`, as it holds no sensitive data)

---

## Phase 7: Polish & Cross-Cutting Concerns

> **Goal:** All ACs satisfied; Lighthouse ≥90; ≥80% test coverage on `api-client.ts` and `formatters.ts`; Playwright E2E green; privacy copy in place.

- [ ] W024 📢 Add landing/login redirect page at `web/src/pages/index.astro` — if authenticated, redirect to `/dashboard`; if not, render a minimal splash ("Sign in to FitHub") with a "Sign in" CTA that initiates the Auth Worker redirect
- [ ] W025 📢 Implement privacy notice page at `/privacy` — describes data collection, retention, and platform token storage; satisfies Constitution §7 transparency requirement; no tracking pixels
- [ ] W026 👤 Add cookie consent banner — simple "We use a session cookie for authentication" notice with dismiss action; banner state stored in `sessionStorage`; no third-party consent scripts
- [ ] W027 ✅ Implement error states for every page — API unreachable → "We're having trouble connecting, please try again" + retry button; empty states for activity list and sync history; no raw error messages or stack traces ever rendered (AC-10)
- [ ] W028 📢 Implement client-side error reporter (`web/src/lib/error-reporter.ts`) — catches unhandled browser errors and `window.onerror`; maps known HTTP status codes to `ErrorCode` enum values; `POST /api/errors` with structured payload; never includes cookies, tokens, or PII (Constitution §8)
- [ ] W029 🧪 Write Playwright E2E tests (`web/e2e/`) — happy path: sign in → connect Zwift (mocked redirect) → trigger sync → see activity; settings: request export → confirmation visible; account deletion: confirmation modal → redirect to logged-out state
- [ ] W030 [P] ⚡ Configure Lighthouse CI — `lighthouserc.cjs`; run against the deployed preview URL (`PAGES_DEPLOYMENT_URL`); assert Lighthouse Performance ≥90 and Best Practices ≥90 on `/dashboard`; wire into GitHub Actions as a required check
- [ ] W031 [P] 🔐 Security hardening — set `Content-Security-Policy` header in Astro middleware: `default-src 'self'`; `script-src 'self'` (no inline scripts); `style-src 'self' 'unsafe-inline'` (Tailwind); verify no third-party scripts load on any authenticated route (Lighthouse "Best Practices" audit)
- [ ] W032 ✅ Verify full suite — `vitest run`, `astro check`, `tsc --noEmit`, `eslint`, Playwright (`--reporter=html`), Lighthouse CI all pass; coverage report shows ≥80% on `api-client.ts` and `formatters.ts`

---

## Dependency Graph

```
W001 → W002, W003, W004 (all parallel after W001)
W001 → W005 → W006 → W007
W008 → W009 → W010 (parallel with W011)
W008 → W011 → W012
W012 → W013 → W014 → W015 → W016
W014 → W017 → W018 → W019+W020 (parallel)
W018 → W021 → W022+W023 (parallel)
W021 → W024 → W025+W026+W027+W028 (parallel)
W027 → W029 → W030+W031+W032 (parallel)
```

**Critical Path:** W001 → W005 → W008 → W009 → W012 → W014 → W018 → W021 → W027 → W029 → W032

---

## Coverage Mapping

| Acceptance Criteria | Task(s)        |
| ------------------- | -------------- |
| AC-1 auth gate       | W005, W006, W007 |
| AC-2 platform status | W013, W014     |
| AC-3 connect flow    | W013 (link placeholder; full flow in 006-*) |
| AC-4 disconnect      | W013, W014     |
| AC-5 sync history    | W017           |
| AC-6 manual sync     | W015, W016     |
| AC-7 activity history| W018, W019     |
| AC-8 settings        | W021, W022, W023 |
| AC-9 browser compat  | W029 (Playwright), W030 (Lighthouse) |
| AC-10 no raw errors  | W027, W032     |
