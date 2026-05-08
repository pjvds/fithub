# Feature Specification: Strava Platform Connection

**Feature Name:** Strava Platform Connection

**Feature ID:** 008-strava-connect

**Version:** 1.0.0

**Status:** Draft

**Authored By:** Copilot

**Date:** 2026-05-08

---

## Problem Statement

**What problem does this feature solve?**

FitHub exists to consolidate fitness activity data across platforms. Strava is the primary fitness network for cyclists and runners. Without a working Connect Strava flow in the web UI, authenticated FitHub users cannot link their Strava account — meaning no Strava activities are ever ingested, and the core product value is inaccessible to Strava users.

The backend infrastructure for Strava OAuth and activity ingestion is already built and tested. The missing piece is the end-to-end web UI flow that lets a user initiate the OAuth authorization, complete it on Strava, and land back on the FitHub dashboard with their Strava connection live.

**Why now?**

This is the last gating step before Strava users can meaningfully use FitHub. The backend is complete; the web frontend connect/callback flow is the only remaining gap before the product delivers its core value proposition.

---

## Proposed Solution

**What is the feature?**

An authenticated FitHub user can connect their Strava account from the dashboard by clicking "Connect Strava." They are redirected to Strava's authorization page, grant FitHub read access to their activities, and are redirected back to the FitHub dashboard. The dashboard immediately reflects the Strava connection as active and FitHub begins ingesting their activities in the background.

A connected user can also disconnect Strava at any time from the dashboard, choosing whether to retain or delete their already-synced Strava activities.

**User Stories**

```
As a Strava user,
I want to connect my Strava account to FitHub from the dashboard,
so that my Strava activities are automatically synced into FitHub.

As a connected user,
I want to see that my Strava connection is active on my dashboard,
so that I know FitHub is ingesting my activities without any manual steps.

As a user who no longer wants Strava data in FitHub,
I want to disconnect Strava from my dashboard,
so that FitHub stops ingesting my activities and I can optionally remove existing ones.
```

---

## User Scenarios

### Scenario 1: First-time Strava Connection (Happy Path)

**Given:** User is logged into FitHub; no Strava connection exists

**When:** User clicks "Connect Strava" on the dashboard

**Then:**
1. User is redirected to Strava's OAuth authorization page
2. User grants FitHub read access to their activities
3. Strava redirects user back to FitHub
4. Dashboard reflects Strava as "Connected" — no manual refresh needed
5. FitHub begins ingesting the user's Strava activities in the background

**Expected Duration:** <2 minutes (excluding time on Strava's authorization page)

### Scenario 2: Already Connected (Re-auth)

**Given:** User's Strava token has expired and requires re-authorization

**When:** User sees "Reconnect" badge on the Strava connection card

**Then:**
1. User clicks "Reconnect" — same OAuth flow as first-time connection
2. Dashboard updates to "Connected" on return

**Expected Duration:** <1 minute

### Scenario 3: Disconnection — Keep Activities

**Given:** User has an active Strava connection with synced activities

**When:** User clicks "Disconnect" and chooses to keep their Strava activities

**Then:**
1. FitHub revokes Strava access and stops future ingestion
2. Existing synced activities remain in FitHub
3. Dashboard shows Strava as "Disconnected"

**Expected Duration:** <2 seconds

### Scenario 4: Disconnection — Delete Activities

**Given:** User has an active Strava connection with synced activities

**When:** User clicks "Disconnect" and chooses to delete their Strava activities

**Then:**
1. FitHub revokes Strava access
2. All Strava-sourced activities are removed from FitHub
3. Dashboard shows Strava as "Disconnected"

**Expected Duration:** <5 seconds

### Scenario 5: OAuth Error / User Denies Access

**Given:** User clicks "Connect Strava" but denies access on Strava's page

**Then:**
1. User is returned to the FitHub dashboard
2. Dashboard shows Strava as "Disconnected" (no change from before)
3. User sees a clear, friendly message explaining that the connection was not completed

**Expected Duration:** Immediate on redirect return

---

## Functional Requirements

**FR1: Connect Flow**
- Authenticated users can initiate a Strava connection from the dashboard
- The initiation redirects the user to Strava's authorization page with the correct read-only scope (`activity:read_all`)
- On successful authorization, the user is returned to the FitHub dashboard
- The dashboard reflects the new Strava connection without a full page reload

**FR2: OAuth Callback Handling**
- The return redirect from Strava is handled gracefully
- Authorization errors (user denied, invalid state) show a user-friendly message and leave the dashboard unchanged
- Successful authorization completes silently and the user sees their dashboard updated

**FR3: Connection Status Display**
- The dashboard shows Strava's connection status: Connected, Reconnect Required, or Disconnected
- A connected Strava card shows the time of the last successful activity sync
- A "Reconnect Required" badge is shown when the token needs re-authorization

**FR4: Disconnect Flow**
- Authenticated users can disconnect Strava from the dashboard
- On disconnect, FitHub stops ingesting Strava activities immediately
- User is offered the choice to retain or delete their already-synced Strava activities
- The dashboard reflects Strava as "Disconnected" without a full page reload

**FR5: Error Handling**
- Network or API failures during the OAuth flow show a user-friendly error message
- The user is never left on a blank or broken page after returning from Strava
- All error messages are plain language — no API codes, stack traces, or internal IDs

---

## Non-Functional Requirements

**NFR1: Security**
- The OAuth state parameter is validated on callback to prevent CSRF attacks
- No OAuth credentials or tokens are exposed in URLs, logs, or the browser address bar after the flow completes
- All communication with Strava's API is over HTTPS

**NFR2: Reliability**
- A failed callback (e.g., expired state) shows a clear error and allows the user to retry
- Disconnecting Strava does not affect the user's FitHub account or other platform connections

**NFR3: Performance**
- The connect initiation redirect happens within 1 second of the user clicking "Connect"
- The dashboard update after returning from Strava is visible within 1 second of page load

---

## Acceptance Criteria

**AC1: Connect flow initiates correctly**
- [ ] Clicking "Connect Strava" on a disconnected/empty dashboard redirects the user to Strava's authorization page
- [ ] The authorization URL requests `activity:read_all` scope
- [ ] The flow works for both the empty-state onboarding button and the ConnectionCard "Connect" button

**AC2: Successful authorization lands user on updated dashboard**
- [ ] After granting access on Strava, user is redirected back to the FitHub dashboard
- [ ] The Strava `ConnectionCard` shows status "Connected"
- [ ] No manual page refresh is required

**AC3: Authorization denial is handled gracefully**
- [ ] If the user denies access on Strava, they are returned to the FitHub dashboard
- [ ] A friendly message explains the connection was not completed
- [ ] Dashboard state is unchanged (Strava still "Disconnected")

**AC4: Disconnect retains or removes activities per user choice**
- [ ] Disconnect flow presents a confirmation offering "Keep activities" or "Delete all Strava activities"
- [ ] Choosing "Keep" revokes access but leaves existing activities in place
- [ ] Choosing "Delete" revokes access and removes all Strava-sourced activities
- [ ] Dashboard shows Strava as "Disconnected" after either choice

**AC5: Re-auth flow works identically to first connect**
- [ ] A connection in `requires_reauth` state shows a "Reconnect" button
- [ ] Clicking it runs the same OAuth flow and returns to an updated dashboard showing "Connected"

**AC6: Error states are user-friendly**
- [ ] Any OAuth or API error during the flow shows a plain-language message
- [ ] No raw error codes, stack traces, or internal IDs are ever visible
- [ ] User can navigate back to the dashboard and retry from any error state

---

## Out of Scope

- **Strava as a login provider** — this feature is about connecting Strava for activity ingestion only; using Strava credentials to sign into FitHub is a separate feature
- **Manual sync trigger** — activity ingestion is automatic after connection; manual sync is handled by the existing Sync Now button
- **Activity display** — this spec covers the connection flow only; the activity list is part of `005-web-frontend`
- **Mobile-native OAuth** — web only; mobile is a future consideration
- **Other platforms** — the connection infrastructure is generic but this spec focuses on Strava

---

## Success Criteria

- A new Strava user can go from "no connection" to "Strava Connected" in under 2 minutes
- 100% of users returning from Strava's auth page land on the dashboard (no broken redirects)
- The Strava connection card reflects the correct status within 1 second of the dashboard loading post-callback
- Disconnection completes (token revoked, UI updated) within 5 seconds of the user confirming

---

## Assumptions

- The backend OAuth endpoints (`/api/connections/strava/oauth/initiate` and `/api/connections/strava/oauth/callback`) are already implemented and tested
- Strava grants FitHub API access with `activity:read_all` scope (confirmed — account is active)
- The web frontend is the v1 client; users are authenticated via the OpenAuth email magic-link before reaching the Strava connect flow
- `REDIRECT_BASE_URL` SST secret can be set to the web frontend origin so the OAuth callback lands on a web frontend route

---

## Dependencies & Related Features

**Dependencies**
- `000-backend-foundation` — backend OAuth initiate, callback, disconnect, and StravaAdapter already implemented
- `005-web-frontend` — dashboard and `ConnectionCard` already built; this spec wires them to the correct backend endpoints

**Related Features**
- `005-web-frontend` — AC-3 (Connect button) and AC-4 (Disconnect) depend on this spec being implemented

---

## Constitution Alignment Checklist

**Principle: Data Privacy & Security** ✅
- [ ] OAuth state validated on callback (CSRF protection)
- [ ] No tokens or credentials in URLs after flow completes
- [ ] All Strava API communication over HTTPS
- [ ] User controls their own connection (explicit connect/disconnect)

**Principle: Cross-Platform Integration** ✅
- [ ] Strava is the first live platform integration end-to-end
- [ ] Connect/disconnect flow is platform-agnostic (uses `:platform` routing)
- [ ] Strava activity ingestion begins automatically after connection

**Principle: User Experience & Simplicity** ✅
- [ ] Connection in <2 minutes
- [ ] Dashboard updates without manual refresh
- [ ] Plain-language errors; no API codes exposed

**Principle: Reliability & Uptime** ✅
- [ ] Expired state / denied access handled gracefully
- [ ] Disconnection does not affect other connections or account

**Principle: Code Quality & Testing** ✅
- [ ] Happy path and error path covered by integration tests
- [ ] No implementation details in spec (spec is frontend-agnostic)

**Principle: Transparency & Communication** ✅
- [ ] User sees which scope is requested (read-only activities)
- [ ] Connection status is always visible on dashboard
- [ ] Disconnect choice is explicit (keep vs. delete)

**Principle: Functional & Structured Logging** ✅
- [ ] OAuth connect and disconnect events are logged by the existing backend (audit_log)

---

**END OF SPECIFICATION**
