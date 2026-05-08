# Task Breakdown: Strava Platform Connection

**Feature:** Strava Platform Connection
**Feature ID:** 008-strava-connect
**Plan Reference:** `.specify/specs/008-strava-connect/plan.md`
**Generated:** 2026-05-08
**Status:** Draft

---

## Task Summary

**Total Tasks:** 16
**Critical Path Length:** 5 sequential phases

| Story | Description | Tasks |
|-------|-------------|-------|
| Foundation | Prerequisites & bug fix | T001–T003 |
| US1 + US2 | Connect Strava + status display | T004–T007 |
| US3 | Disconnect with keep/delete confirmation | T008–T011 |
| Polish | Tests, validation, spec close-out | T012–T016 |

**Parallel Opportunities:**
- T004 and T005 can run simultaneously (different files, no interdependency)
- T008 and T009 can run simultaneously (different files, no interdependency)
- T012 and T013 can run simultaneously (different test files)

**Suggested MVP Scope:** Phase 1 Setup + Phase 2 Foundational + Phase 3 (US1/US2) = T001–T007. This delivers a working end-to-end connect flow. Disconnect confirmation (US3) can follow independently.

---

## Phase 1: Setup

> Operational prerequisites. Must be in place before E2E testing is possible.
> **Independent test criterion:** Backend initiate endpoint returns an `authUrl` that begins with `https://www.strava.com/oauth/authorize` and includes a `redirect_uri` pointing to `https://app.fithub.space/api/connections/strava/oauth/callback`.

- [ ] T001 Verify Strava API application settings include `${REDIRECT_BASE_URL}/api/connections/strava/oauth/callback` as an authorized redirect URI at https://www.strava.com/settings/api — add if missing
- [ ] T002 Set `REDIRECT_BASE_URL` SST Secret to the web frontend origin: `npx sst secret set REDIRECT_BASE_URL https://app.fithub.space` (run from repo root; repeat for each required stage)

---

## Phase 2: Foundational

> Blocking bug fix. Must be resolved before the disconnect flow (US3) can work correctly. Can be implemented independently of the connect flow tasks.
> **Independent test criterion:** Calling `POST /api/connections/strava/disconnect` from `ConnectionCard.astro` sends the request to the correct backend route `/api/connections/strava/disconnect` (platform-based, not UUID-based).

- [ ] T003 Fix bug in `web/src/components/ConnectionCard.astro` — change disconnect form action from `connection.id` (UUID) to `connection.platform` so the form POSTs to `/api/connections/${connection.platform}/disconnect` (matches backend route `POST /api/connections/:platform/disconnect`)

---

## Phase 3: US1 + US2 — Connect Strava & See Active Status

> **User Story 1:** "As a Strava user, I want to connect my Strava account to FitHub from the dashboard, so that my Strava activities are automatically synced into FitHub."
> **User Story 2:** "As a connected user, I want to see that my Strava connection is active on my dashboard, so that I know FitHub is ingesting my activities without any manual steps."
> **Independent test criterion:** A logged-in user can click "Connect Strava," be redirected to Strava's auth page, return to FitHub, and see the dashboard flash "Strava connected!" with the ConnectionCard showing status "Connected" — without a manual page refresh.

- [ ] T004 [P] [US1] Create `web/src/pages/api/connections/[platform]/connect.astro` — POST-only Astro SSR handler: reads `access_token` cookie, calls backend `POST ${API_URL}/api/connections/${platform}/oauth/initiate` with the cookie as `Authorization: Bearer`, returns `Astro.redirect(authUrl, 302)` on success or `Astro.redirect('/dashboard?error=connect_failed', 302)` on failure
- [ ] T005 [P] [US1] Create `web/src/pages/api/connections/[platform]/oauth/callback.astro` — GET-only Astro SSR handler: reads `?code` and `?state` query params; if `?error` present (Strava denial) redirect to `/dashboard?error=${error}`; otherwise POST `{ code, state }` to backend `POST ${API_URL}/api/connections/${platform}/oauth/callback` with auth cookie; on 201 redirect to `/dashboard?connected=${platform}`; on error redirect to `/dashboard?error=connect_failed`
- [ ] T006 [US1] Update `web/src/components/ConnectionCard.astro` — replace `<a href="${authWorkerUrl}/connect/${platform}">` Connect button and Re-auth button (lines ~55, ~62) with `<form method="POST" action="/api/connections/${platform}/connect"><button type="submit">Connect</button></form>` and `<form method="POST" action="/api/connections/${platform}/connect"><button type="submit">Re-authenticate</button></form>`; remove `authWorkerUrl` prop from these buttons (prop may stay for other uses)
- [ ] T007 [US1] Update `web/src/pages/dashboard.astro` — (1) replace empty-state "Connect Strava" `<a href="${authWorkerUrl}/connect/strava">` (line ~76) with `<form method="POST" action="/api/connections/strava/connect"><button type="submit">Connect Strava</button></form>`; (2) add server-side flash banner block reading `Astro.url.searchParams`: show success banner for `?connected=strava` ("Strava connected! Your activities are being synced.") and error banner for `?error` param with plain-language messages mapped from error code

---

## Phase 4: US3 — Disconnect with Keep/Delete Confirmation

> **User Story 3:** "As a user who no longer wants Strava data in FitHub, I want to disconnect Strava from my dashboard, so that FitHub stops ingesting my activities and I can optionally remove existing ones."
> **Independent test criterion:** A connected user can click "Disconnect," see a confirmation dialog offering "Keep my activities" and "Delete all Strava activities," choose either option, and land on the dashboard showing "Strava disconnected" — with activities retained or removed per their choice.
> **Depends on:** T003 (disconnect form URL bug fix must already be in place)

- [ ] T008 [P] [US3] Create `web/src/components/DisconnectButton.tsx` — React island: renders a "Disconnect" button; clicking opens an inline modal/popover showing platform name, warning text, and two form-submit buttons: `<form method="POST" action="/api/connections/${platform}/disconnect"><input type="hidden" name="delete_data" value="false"><button>Keep my activities</button></form>` and the same with `value="true"` / "Delete all Strava activities"; include loading state during submit; no external dependencies beyond React (already in project)
- [ ] T009 [P] [US3] Create `web/src/pages/api/connections/[platform]/disconnect.astro` — POST-only Astro SSR handler: reads `delete_data` field from `await Astro.request.formData()`; calls backend `POST ${API_URL}/api/connections/${platform}/disconnect` with body `{ delete_data: deleteData === "true" }` and auth cookie; on success redirect to `/dashboard?disconnected=${platform}`; on error redirect to `/dashboard?error=disconnect_failed`
- [ ] T010 [US3] Update `web/src/components/ConnectionCard.astro` — replace the bare disconnect `<form>` (the one with the bug partially fixed in T003) with `<DisconnectButton client:load platform={connection.platform} />` React island import; ensure `DisconnectButton` receives `platform` prop
- [ ] T011 [US3] Update `web/src/pages/dashboard.astro` — add `?disconnected` flash banner: when `Astro.url.searchParams.get('disconnected')` is set, show success banner "Strava disconnected. Your data has been handled per your choice."

---

## Phase 5: Polish & Cross-Cutting Concerns

> Tests, validation, and spec housekeeping.
> **Independent test criterion:** `npm run test` in `web/` passes with no regressions; all AC1–AC6 confirmed on staging.

- [ ] T012 [P] Write unit tests for `web/src/components/DisconnectButton.tsx` — Vitest + React Testing Library: (1) button renders without dialog; (2) clicking button opens dialog; (3) Cancel button hides dialog; (4) "Keep my activities" submits form with `delete_data=false`; (5) "Delete all Strava activities" submits form with `delete_data=true`; (6) button shows loading state on submit
- [ ] T013 [P] Write integration tests for Astro connect and callback handlers in `web/src/pages/api/connections/` — Vitest + MSW mock backend: (1) connect handler → mocked initiate returns `{ authUrl }` → verify 302 to authUrl; (2) callback handler with `?code&state` → mocked backend 201 → verify redirect to `/dashboard?connected=strava`; (3) callback with `?error=access_denied` → verify redirect to `/dashboard?error=access_denied`; (4) callback with mocked backend 400 → verify redirect to `/dashboard?error=connect_failed`; (5) disconnect handler `delete_data=false` → verify backend called with correct body + redirect to `/dashboard?disconnected=strava`; (6) disconnect handler `delete_data=true` → verify backend called with `{ delete_data: true }`
- [ ] T014 Run full test suite in web package — `cd web && npm run test` — confirm no regressions in existing auth flow, dashboard rendering, or activity display
- [ ] T015 Manually verify acceptance criteria AC1–AC6 on staging against the checklist in `.specify/specs/008-strava-connect/spec.md`
- [ ] T016 Update `.specify/specs/008-strava-connect/spec.md` — change `**Status:** Draft` to `**Status:** Implemented`

---

## Dependency Graph

```
T001 ──┐
T002 ──┼── E2E testing possible
T003 ──┘       │
               │
T004 ─┐        │
T005 ─┤ (parallel) → T006 → T007  ← US1+US2 complete
      └─────────────────────────────────────────────────┐
                                                        │
T008 ─┐                                                 │
T009 ─┤ (parallel) → T010 → T011  ← US3 complete      │
                                                        │
                             └──────────────────────────┼──→ T012 ─┐
                                                        │   T013 ─┤ (parallel) → T014 → T015 → T016
                                                        └──────────┘
```

**Critical path:** T002 → T004 → T005 → T006 → T007 → T008 → T009 → T010 → T011 → T013 → T014 → T015 → T016

**Parallel execution example (2 streams):**
- Stream A: T001 → T002 → T004 → T006 → T007 → T012
- Stream B: T003 → T005 → T008 → T009 → T010 → T011 → T013
- Converge: T014 → T015 → T016

---

## Implementation Strategy

**MVP (Phase 1–3, T001–T007):** Delivers the complete connect flow end-to-end. A user can click "Connect Strava," authorize on Strava, and return to a dashboard showing "Strava Connected." This covers US1 and US2. US3 (disconnect) uses the existing bare form with the bug fix from T003 (no confirmation dialog yet — sends a basic disconnect request).

**Full feature (all phases):** Adds the confirmation dialog (DisconnectButton), the disconnect Astro handler, and all tests.

**No schema changes required.** All backend endpoints are already implemented.

---

*Generated by speckit-tasks from `.specify/specs/008-strava-connect/plan.md` and `spec.md`*
