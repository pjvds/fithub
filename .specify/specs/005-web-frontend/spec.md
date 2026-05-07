# Feature Specification: Web Frontend (FitHub v1)

## Feature Overview

**Feature Name:** Web Frontend (FitHub v1)

**Feature ID:** feat-005-web-frontend

**Version:** 1.0.0

**Status:** Draft

**Authored By:** Copilot

**Date:** 2026-05-06

---

## Problem Statement

**What problem does this feature solve?**

FitHub's value depends on users being able to *see* and *act on* their consolidated fitness data. With native mobile postponed, the v1 product needs a web user interface where authenticated users can:

- Connect/disconnect their Zwift and Strava accounts
- View their unified, deduplicated activity history
- See sync status and recent sync results
- Manually trigger a sync when they want fresh data
- Manage account settings (display preferences, account deletion, data export)

Without a web frontend, the backend (`000-backend-foundation`) ships APIs that no end user can reach. This feature is the user-facing surface that makes FitHub usable in v1.

**Why now?**

- The mobile pivot (2026-05-06) made web the primary client for v1.
- The backend foundation work is in flight; specifying the web client now prevents API mismatch and lets backend and web work move in parallel once both specs are planned.
- Defining the web client inside the same SST project enables typed bindings between the two and a single deployment unit.

---

## Proposed Solution

**What is the feature?**

A user-facing web application built with Astro on Cloudflare, hosted inside the same SST project as the backend Workers. The site provides authenticated users with a small, focused dashboard around their fitness-platform connections and activity history.

The experience is intentionally narrow for v1:

1. **Login** (delegated to the backend Auth Worker)
2. **Dashboard** showing connected platforms, last sync time, and a summary of recent activities
3. **Sync history** view listing recent sync jobs with success/failure status
4. **Manual sync** button to trigger a fresh poll
5. **Settings** page for profile information, GDPR export request, and account deletion

**User Stories**

```
As a fitness enthusiast,
I want to log in to FitHub on the web,
so that I can see all my synced activities in one place without installing anything.
```

```
As a user with both Zwift and Strava accounts,
I want a dashboard that shows which platforms are connected and when each last synced,
so that I quickly understand the health of my data pipeline.
```

```
As a user who just finished a ride,
I want to click a "Sync now" button,
so that I do not have to wait for the next scheduled poll to see my activity.
```

```
As a privacy-conscious user,
I want to request a data export or delete my account from a settings page,
so that I retain control over my data without having to email support.
```

**Acceptance Criteria**

- [ ] AC-1: Unauthenticated visitors hitting any non-public route are redirected to the auth flow and returned to their originally requested page after login.
- [ ] AC-2: Authenticated users see a dashboard listing each connected fitness platform with a status badge (connected, degraded, disconnected) and the time of the last successful sync.
- [ ] AC-3: Authenticated users can connect Zwift and/or Strava by clicking a "Connect" button that initiates the platform's OAuth flow via the backend Auth Worker; the dashboard reflects the new connection without manual page refresh after the redirect returns.
- [ ] AC-4: Authenticated users can disconnect any connected platform from the dashboard; the platform shows as disconnected immediately after the action.
- [ ] AC-5: A "Sync history" view lists the user's most recent sync jobs (at minimum the last 30 days or the last 50 jobs, whichever is smaller) with platform, status (success / partial / failed), start time, and a summary of new/merged activities.
- [ ] AC-6: A "Manual sync" button on the dashboard triggers an immediate sync for one or all connected platforms; the UI shows a pending state within 1 second of the click and resolves to success or failure within 30 seconds (or shows a timeout error if the backend has not responded).
- [ ] AC-7: An "Activity history" view lists recent canonical activities with date, type, distance/duration, and source badges showing which platforms contributed (e.g., "Zwift + Strava").
- [ ] AC-8: A "Settings" page allows the user to: view their email/display name, request a data export, and initiate account deletion (with confirmation).
- [ ] AC-9: All authenticated pages function on the latest two major versions of Chrome, Firefox, Safari, and Edge, on both desktop and mobile-browser viewports.
- [ ] AC-10: All user-facing copy follows the constitution's clarity principle (no raw stack traces or internal IDs in error states).

---

## Constitution Alignment Checklist

### ✅ Data Privacy & Security
- [x] User data is encrypted at rest (handled by backend; web stores no fitness data locally)
- [x] Data transmission uses TLS 1.3+ (Cloudflare default)
- [x] User consent is explicit and revocable (connect/disconnect flows; delete-account path)
- [x] Third-party integrations vetted for security (the only third-party calls are server-mediated OAuth flows)
- **Notes:** Web client is a thin consumer of the backend API. Session is carried by an `HttpOnly`, `Secure`, `SameSite=Lax` cookie scoped to the apex domain. No fitness tokens, no user-identifying secrets, are ever stored in browser storage.

### ✅ Cross-Platform Integration
- [x] Adapter/integration follows platform-specific API requirements (web only consumes FitHub's own API; OAuth handshakes are backend-driven)
- [x] Rate limits and retry logic implemented (web retries are limited to backend API calls; backoff lives in the API client)
- [x] Conflict detection logic defined (handled by backend dedup engine; web only renders results)
- [x] Platform-specific data normalization documented (rendering uses the canonical activity model defined by the backend)
- **Notes:** Web is decoupled from external fitness platforms — all platform variability is hidden behind FitHub's typed JSON API.

### ✅ User Experience & Simplicity
- [x] Onboarding/setup completable in <5 minutes (login → connect a platform → see first sync)
- [x] Error messages are clear and actionable
- [x] Advanced options hidden by default (settings page is opt-in)
- [x] Fewer than 3 clicks for core action (dashboard → "Sync now" = 1 click)
- **Notes:** Mobile-browser viewports are a first-class target so the experience is usable on a phone even without a native app.

### ✅ Reliability & Uptime
- [x] Offline scenarios handled (UI shows cached last-known data when API is unreachable; mutations show clear failure states with retry option)
- [x] Failed operations retry with exponential backoff (API client wraps `fetch` with retry on transient errors)
- [x] Data persistence survives app restart/reboot (session cookie persists; no local mutable state to lose)
- [x] Monitoring/alerting requirements defined (frontend errors reported via lightweight error endpoint; uptime monitored via standard Cloudflare metrics)
- **Notes:** Web client owns no source-of-truth state, so reliability hinges on the backend. The web app degrades gracefully when individual API calls fail.

### ✅ Performance & Real-Time Sync
- [x] Latency targets defined (initial dashboard render ≤2s P95 on broadband; manual-sync feedback within 1s of click)
- [x] Caching strategy documented (Astro static shell with cached HTML; API responses use HTTP cache headers; islands hydrate as needed)
- [x] Batching/optimization approach defined (dashboard issues a single aggregate API call instead of per-platform calls)
- [x] Performance regression testing planned (Lighthouse CI on key routes; perf budget enforced)
- **Notes:** Astro's island architecture keeps the JS payload small. Static-first rendering keeps Core Web Vitals strong without aggressive caching of personal data.

### ✅ Code Quality & Testing
- [x] Unit test coverage target ≥80% for client logic (API client, formatters, state hooks)
- [x] Integration test scenarios identified (mocked API + island components)
- [x] E2E test plan defined (Playwright against a deployed preview env)
- [x] Code review process enforced in PR (per project standard)
- [x] Static analysis (linting, type-checking) requirements listed (ESLint + TypeScript shared config from repo root; `astro check` in CI)
- **Notes:** Snapshot tests for rendered components per project preference for golden-file testing where it fits.

### ✅ Transparency & Communication
- [x] User-facing documentation/help text planned (in-app help links from each settings option; FAQ page for common errors)
- [x] Privacy/data handling implications documented (privacy page explains backend storage of fitness tokens)
- [x] Known limitations or caveats identified (e.g., Apple Health unavailable on web; mobile app deferred)
- [x] Release notes content drafted (one-line entry per release in a public changelog page)
- **Notes:** A small banner on the marketing-style landing page disclaims that mobile apps are coming later, so users are not surprised.

### ✅ Functional & Structured Logging
- [x] Web app uses the shared structured logger (`@fithub/core/logging`) for any server-side rendered routes / serverless functions it owns; no free-text `console.*` logging in production code
- [x] Frontend error reporter forwards browser-side errors to a backend ingest endpoint that re-emits them through the structured logger with `service: "web"` and a generated `correlationId`
- [x] Outgoing API calls forward the active `x-correlation-id` header (or mint one) so backend logs can be correlated with a user-visible page action
- [x] Sensitive data deny-list honored: tokens, cookies, raw payloads, and PII are never included in client-side error reports
- [x] Error reports include a typed error code (from the shared `ErrorCode` enum) where it can be inferred (e.g., 401 → `AUTH_INVALID_TOKEN`)
- **Notes:** Constitution Principle 8 applies symmetrically to the web client. Astro server endpoints inherit the same logger contract as Workers.

---

## Technical Specification

### Scope

**In Scope:**

- Astro-based static-first web app, deployed via SST as a Cloudflare static site
- Authentication via the existing backend Auth Worker (OpenAuth.js); session via `HttpOnly` cookie
- Pages: landing/login redirect, dashboard, sync history, activity history, settings
- A typed API client (using shared types from `@fithub/core` workspace package) for all backend calls
- A "Sync now" action that calls `POST /api/sync/trigger`
- Connect/disconnect flows for Zwift and Strava that delegate the OAuth dance to the backend
- A simple visual design system (Tailwind CSS + a small set of components) consistent across pages
- Responsive layouts for desktop and mobile browsers
- Lighthouse-driven perf budgets, Playwright E2E coverage of the happy path, and unit tests around the API client
- Cookie consent and a privacy notice page (purely informational; no tracking cookies in v1)

**Out of Scope:**

- Native mobile apps and any HealthKit/Health Connect features (postponed)
- Push notifications (web push, APNs/FCM) — deferred until mobile or a clear web-push need emerges
- Real-time updates via WebSockets/SSE — v1 uses HTTP polling/manual refresh
- Multi-user or team accounts; v1 is single-user
- Marketing site / blog / SEO content beyond a minimal landing page
- Internationalization beyond English in v1
- Embedding third-party analytics (privacy posture: zero third-party scripts in v1)
- Offline-first PWA / installable shell (deferred; v1 requires connectivity for any meaningful action)

### Technical Constraints

- **Platform Compatibility:** Latest 2 major versions of Chrome, Firefox, Safari, Edge; desktop + mobile viewports
- **API/Service Dependencies:** FitHub backend (`000-backend-foundation`); future Auth Worker (`006-zwift-oauth-web`, `007-strava-oauth-web` flows)
- **Data Format/Schema Changes:** None to backend; web consumes the existing API and shared types
- **Performance Requirements:** ≤2s P95 dashboard render on broadband; ≤200KB JS for initial dashboard route after gzip
- **Security/Compliance:** GDPR-aligned (export and delete flows visible from settings); no third-party trackers; no fitness data persisted in the browser beyond ephemeral session memory; CSP locked down to first-party origins plus Cloudflare

### Architecture & Components

The web app is one workspace member alongside `packages/core` and `packages/functions`, all owned by the SST project at the repo root.

```
┌──────────────────────────────────────────────────────────────┐
│                Browser (latest evergreen)                     │
│      ┌──────────────────────────────────────────────┐         │
│      │  Astro pages + targeted islands (TS)         │         │
│      │  - Auth gate                                 │         │
│      │  - Dashboard, sync history, activity history │         │
│      │  - Settings                                  │         │
│      │  - Typed API client (shared types)           │         │
│      └─────────────────┬────────────────────────────┘         │
└────────────────────────┼─────────────────────────────────────┘
                         │ HTTPS + HttpOnly session cookie
            ┌────────────▼────────────┐  ┌──────────────────────┐
            │   API Worker            │  │  Auth Worker         │
            │   /api/* (read + write) │  │  /auth/* (OpenAuth)  │
            └────────────┬────────────┘  └──────────────────────┘
                         │ shared bindings (D1, R2, Queues)
                         ▼
                Backend (per architecture-overview.md)
```

**Component Changes:**

- New workspace member `web/` with Astro project, Tailwind config, and shared `tsconfig` extending the root base
- New SST resource (`sst.cloudflare.StaticSite`) referencing `web/` as the build target, attached to the existing app domain
- Extension of the API Gateway (in backend) only as needed to expose endpoints the web client requires; net-new endpoints captured in `006-zwift-oauth-web` / `007-strava-oauth-web`, not here
- Shared types: `packages/core` exports the response/request shapes consumed by the web API client

---

## Implementation Approach

**High-Level Steps:**

1. Add `web/` workspace and Astro app skeleton; wire ESLint, TypeScript, and Tailwind from the repo root
2. Add SST `StaticSite` resource and wire CI build/deploy alongside Workers
3. Build the API client using shared `@fithub/core` types and a thin `fetch` wrapper with retries
4. Implement the auth gate (redirect-to-Auth-Worker pattern) and a stubbed dashboard backed by mocked endpoints
5. Implement dashboard, activity history, sync history, and settings pages against real API endpoints as they ship from `000-backend-foundation`
6. Add Playwright E2E tests for the happy path, Lighthouse CI for perf budgets, and unit tests for the API client
7. Polish copy, error states, and the privacy/landing pages; sign off on the Constitution Alignment Checklist

**Dependencies & Blockers:**

- [ ] Dependency 1: `000-backend-foundation` provides the production-ready API endpoints listed under AC-2 through AC-7
- [ ] Dependency 2: `006-zwift-oauth-web` and `007-strava-oauth-web` (future specs) define the OAuth redirect contracts the web app links into
- [ ] Dependency 3: Domain DNS / Cloudflare configuration must allow a shared apex with `app.fithub.app` and `auth.fithub.app` for cookie-scoped sessions
- [ ] Blocker (none yet): the web app is largely independent and can progress against mocked APIs while backend matures

**Risk Assessment:**

- **Risk 1:** Backend API contracts shift after the web work begins. **Mitigation:** Keep all I/O typed via `@fithub/core`; rely on TypeScript breaks at compile time as the change-detection mechanism.
- **Risk 2:** Authentication redirect loops between `app.fithub.app` and `auth.fithub.app`. **Mitigation:** Document and test the redirect contract as part of the auth gate's unit/E2E suite; share fixtures across web and Auth Worker.
- **Risk 3:** Performance budget violated by adding an island per dashboard widget. **Mitigation:** Lighthouse CI in the deploy pipeline; PRs that regress the budget fail CI.

---

## Testing Strategy

**Unit Tests:**

- API client: success, retry, auth-required redirects, and parse-error paths
- Pure formatters (duration, distance, source-badge composition)
- Auth gate logic (cookie present vs. missing; redirect target preserved)

**Integration Tests:**

- Astro pages render against a mocked API (MSW or equivalent)
- Hydration of islands does not throw and does not request extra network calls beyond their declared API needs

**End-to-End Tests:**

- Happy path: sign in → connect Zwift → trigger manual sync → see at least one activity → sign out
- Settings: request export → confirmation visible
- Settings: initiate account deletion (mocked terminal step) → user is redirected to a logged-out state

**Manual Testing Checklist:**

- [ ] Happy path verified on Chrome (desktop + mobile viewport)
- [ ] Happy path verified on Safari (desktop + mobile viewport)
- [ ] Auth redirect honored across both subdomains
- [ ] All pages render without console errors
- [ ] Performance acceptable (Lighthouse score ≥90 for Performance and Best Practices on the dashboard route)

---

## Success Metrics

- **Metric 1:** Lighthouse Performance ≥90 on the authenticated dashboard route, P95 over 10 runs in CI
- **Metric 2:** ≥80% line coverage on the API client and formatter modules
- **Metric 3:** Zero third-party scripts loaded on any authenticated route (verified by CSP report and Lighthouse "Best Practices" audit)
- **Metric 4:** Time-to-first-meaningful-content (dashboard with at least one activity card or empty state) ≤2s P95 on broadband
- **Metric 5:** New user can complete login → connect platform → trigger first sync within 5 minutes (recorded during usability walk-through)

---

## Open Questions & Decisions

- **Question 1:** Do we ship a public-facing marketing landing page in this spec, or stub it to a minimal "Sign in" splash?
  - **Resolution:** Stub for v1 — minimal splash with sign-in CTA only. A real marketing site is its own future spec.
- **Question 2:** Do we build a notifications surface in the UI (e.g., in-app banner when a sync fails)?
  - **Resolution:** Yes, but only as a polled banner read off the sync history; no push, no SSE, no service workers in v1.
- **Question 3:** Do we need a feature flag system to gate features as they roll in?
  - **Resolution:** Out of scope for v1; flags will be added when there is a second feature competing for the same surface.

---

## Approval & Sign-Off

- [ ] Architecture review: _________________________ Date: _______
- [ ] Security review (if applicable): ____________ Date: _______
- [ ] Product/stakeholder approval: ______________ Date: _______
- [ ] Ready to move to planning: ________________ Date: _______

---

## Assumptions

- Web is the **only** user-facing client in v1; mobile is postponed and Apple Health is postponed with it.
- Astro is the chosen framework (decided 2026-05-06); the choice supersedes any prior Flutter Web evaluation.
- Authentication is delegated to a backend OpenAuth.js Worker; the web client never holds platform OAuth tokens.
- Domain layout: `app.fithub.app` for the web client, `auth.fithub.app` for the Auth Worker, sharing an apex-scoped session cookie.
- Tailwind CSS will be used for styling unless a strong reason emerges during planning to switch.

---

## Related Documents

- Constitution: `.specify/memory/constitution.md`
- Architecture: `.specify/memory/architecture-overview.md`
- Tech Stack: `.specify/memory/tech-stack.md`
- Backend Foundation: `.specify/specs/000-backend-foundation/spec.md`
- Implementation Plan: (to be created via speckit-plan)
- Task Breakdown: (to be created via speckit-tasks)
- Superseded Specs: `.specify/specs/002-zwift-oauth/spec.md`, `.specify/specs/003-strava-oauth/spec.md`
- Postponed Specs: `.specify/specs/004-apple-health-integration/spec.md`
