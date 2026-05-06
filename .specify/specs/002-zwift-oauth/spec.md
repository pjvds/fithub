# Feature Specification: Zwift OAuth Integration

> **Status: SUPERSEDED (2026-05-06).** This Flutter-mobile-oriented OAuth spec is superseded by a future `006-zwift-oauth-web` spec that defines the server-driven OAuth flow used by the v1 Astro web frontend. Tokens already live server-side per `architecture-overview.md` AD-1, so the migration is mostly UI/redirect related. Retained here for historical context — **do not implement against this spec.**

---

## Overview

**Feature Name:** Zwift OAuth Integration

**Feature ID:** feat-002-zwift-oauth

**Version:** 1.0.0

**Status:** Draft

**Created:** 2026-05-05

---

## Problem Statement

FitHub needs to integrate with Zwift to allow users to sync their cycling and running workouts. Zwift is a popular virtual fitness platform with millions of users who track structured workouts. Without Zwift integration, FitHub cannot fulfill its core use case of cross-platform fitness data synchronization.

---

## Vision

Users with Zwift accounts can securely authorize FitHub to access their workout data, and automatically sync their Zwift activities into FitHub's unified workout dashboard.

---

## Assumptions

1. **Zwift API availability:** Zwift API v1/v2 has OAuth 2.0 support with public documentation
2. **Mobile-first:** Feature prioritizes mobile (iOS/Android) OAuth flow over web
3. **Incremental sync:** On first sync, we fetch last 1 year of activities; subsequent syncs fetch new activities only
4. **Data volume:** Assume typical user has 50-500 activities/year
5. **Connection persistence:** OAuth tokens are stored exclusively on the FitHub backend (encrypted at rest in D1, AES-256-GCM, format `v1:iv:ciphertext:tag`). Tokens are never returned to the mobile client. Mobile receives only connection status and metadata (e.g., last-sync timestamp). See `000-backend-foundation` AC-1.
6. **Rate limits:** Zwift API has standard rate limits (100-1000 req/min); we implement exponential backoff

---

## User Scenarios

### Scenario 1: First-Time Connection (Happy Path)

**Actor:** Fitness enthusiast who already uses Zwift

**Goal:** Connect their Zwift account to FitHub

**Steps:**
1. User opens FitHub app and sees "Connect Fitness Platforms" section
2. User taps "Connect Zwift"
3. FitHub redirects to Zwift login page (mobile browser)
4. User enters Zwift credentials (or uses existing session)
5. Zwift shows OAuth permission screen ("FitHub wants to access your activities")
6. User taps "Authorize"
7. Zwift redirects back to FitHub app with authorization code
8. FitHub exchanges code for access token (background)
9. FitHub fetches user's Zwift profile and last year of activities
10. Connection complete—user sees "Connected to Zwift" with athlete name and last sync timestamp

**Result:** User's Zwift account is connected and activities are synced

---

### Scenario 2: Manual Sync Trigger

**Actor:** Connected user who just completed a Zwift workout

**Goal:** Manually sync to see latest workout

**Steps:**
1. User completes a workout in Zwift
2. User returns to FitHub and taps "Sync Now"
3. FitHub fetches new activities from Zwift API
4. New workout appears in the app within 30 seconds
5. Sync completes with "Last synced: [timestamp]"

**Result:** Latest Zwift workouts are visible in FitHub

---

### Scenario 3: Disconnect

**Actor:** Connected user who no longer wants FitHub accessing their Zwift data

**Goal:** Revoke FitHub's access to Zwift

**Steps:**
1. User navigates to Settings → Connected Apps → Zwift
2. User taps "Disconnect"
3. Confirmation dialog presents two options: "Keep my Zwift activities in FitHub" / "Delete all Zwift activities"
4. User confirms with their data choice
5. Mobile calls `DELETE /api/connections/zwift` on the FitHub backend
6. Backend revokes the OAuth token with Zwift, deletes the encrypted token row from D1 `oauth_connections`, and cancels any in-flight scheduler jobs for this user-platform pair
7. If the user chose "delete": backend removes Zwift `activity_sources` rows; canonical `activities` rows are kept if they have other sources, otherwise deleted (lossless multi-source model — see architecture-overview AD-4)
8. Backend pushes connection-status update to mobile (see `000-backend-foundation` AC-6)
9. Mobile UI updates to "Not connected"; future Zwift syncs blocked until re-authorization

**Result:** No FitHub access to Zwift data; clean disconnection consistent with `000-backend-foundation` AC-10

---

## Functional Requirements

### Core Requirements

**Req-1: OAuth Authorization Flow**
- FitHub implements Zwift OAuth 2.0 authorization code flow (RFC 6749)
- Uses PKCE (RFC 7636) for mobile security
- Redirects user to Zwift login, captures authorization code, exchanges for access token
- Access and refresh tokens stored server-side in D1 `oauth_connections` table, encrypted at the application layer with AES-256-GCM (format `v1:iv:ciphertext:tag`). Tokens are accessed only by the `worker` and `scheduler` Cloudflare Workers; never transmitted to mobile clients. (See `000-backend-foundation` AC-1; `001-user-authentication` for user session auth.)
- Acceptance: User can complete OAuth flow from app → authorization → return to app in <3 minutes; no token material is observable on the device or in client traffic

**Req-2: Token Refresh**
- FitHub automatically refreshes expired access tokens without user interaction
- Token refresh happens 5 minutes before expiration
- If refresh fails (e.g., user revoked on Zwift), app notifies user and prompts re-authentication
- Acceptance: No unexpected re-auth prompts during normal usage; refresh attempts logged

**Req-3: Athlete Profile Fetch**
- On first connection, FitHub fetches user's Zwift athlete profile (name, profile URL, stats)
- Profile cached locally; refreshed on each sync
- Acceptance: Athlete profile displayed accurately in app; updates within 5 minutes of Zwift changes

**Req-4: Activity Fetch & Pagination**
- FitHub fetches user's Zwift activities via `/athlete/activities` endpoint
- First sync fetches last 12 months of activities (paginated, 50 activities/page)
- Subsequent syncs fetch only new activities (delta-based)
- Handles pagination gracefully (no UI freezing)
- Acceptance: 100+ activities fetched without freezing app; pagination completes within 2 minutes

**Req-5: Activity Normalization**
- Zwift activities mapped to FitHub's canonical `Workout` data model
- Required fields mapped: id, name, type, start_time, duration, distance, calories, sport
- Optional fields: elevation, average_heart_rate, average_power (if available in Zwift data)
- Custom Zwift fields retained in metadata (e.g., trainer status, resistance level)
- Acceptance: Workflow data accurate; no loss of critical fields during normalization

**Req-6: Connection Status Display**
- App shows connection status: "Connected to Zwift since [date]" or "Not connected"
- Last sync timestamp displayed ("Last synced: [relative time]")
- Connection status accessible from main dashboard and settings
- Acceptance: Status visible, current, and easily understood by non-technical users

**Req-7: Sync Trigger**
- User can manually trigger sync via "Sync Now" button
- Auto-sync occurs every 30 minutes (configurable)
- Sync fails gracefully (shows error message, retries later)
- Acceptance: Manual sync completes within 1 minute; auto-sync doesn't drain battery

**Req-8: Disconnect & Data Cleanup**
- User can disconnect Zwift account from app settings
- On disconnect: access token revoked with Zwift, all local Zwift data deleted
- After disconnect, user can reconnect (fresh authorization flow)
- Acceptance: No Zwift data remains after disconnect; reconnection works as new connection

**Req-9: Error Handling**
- Network errors, API timeouts, rate limits handled gracefully
- User sees clear, actionable error messages (e.g., "Zwift temporarily unavailable—try again in 5 minutes")
- Errors logged for debugging without exposing technical details to user
- Acceptance: User receives helpful guidance on every error; no app crashes from Zwift API failures

---

## Non-Functional Requirements

### Security & Privacy

**Req-NF-1: Token Security**
- Access tokens encrypted at rest (AES-256)
- Tokens transmitted over TLS 1.3+ only
- Tokens never logged or exposed in debug logs
- Acceptance: Security audit confirms no token exposure; encryption keys rotate securely

**Req-NF-2: User Consent & Revocation**
- OAuth permission screen clearly explains what FitHub accesses
- User can revoke access anytime; FitHub deletes all Zwift data on revocation
- GDPR/CCPA compliance: right to data deletion honored immediately
- Acceptance: Legal review confirms compliance; user can revoke with one tap

**Req-NF-3: Data Minimization**
- FitHub requests only necessary Zwift scopes (activities, profile)
- No request for personal data beyond what's needed for workouts
- Acceptance: Zwift OAuth permission screen shows minimal, justified scopes

---

### Performance

**Req-NF-4: Sync Latency**
- First sync completes within 2 minutes (100+ activities, normalization)
- Subsequent syncs (delta) complete within 30 seconds
- UI remains responsive during sync (background threads/async operations)
- Acceptance: Sync performance measured and logged; UI not frozen during sync

**Req-NF-5: Rate Limit Compliance**
- Respects Zwift API rate limits (typically 600 requests per 15 minutes)
- Implements exponential backoff on 429 (Too Many Requests) responses
- Max retry attempts: 7 times, max wait: 60 seconds
- Acceptance: No 429 errors in normal usage; backoff strategy tested

**Req-NF-6: Battery/Network Efficiency**
- Auto-sync doesn't run too frequently; 30-minute intervals optimal for battery
- Sync uses WiFi when available, adapts to cellular (reduced frequency on cellular)
- Large activity fetches batched to minimize data transfer
- Acceptance: Battery drain minimal (<1% per day from Zwift sync); data usage <10MB/month

---

### Reliability

**Req-NF-7: Offline Resilience**
- Sync orchestration lives on the backend (Cloudflare Queues with exponential backoff per `000-backend-foundation` AC-8). Platform-side polling and retry are the backend's responsibility, independent of the mobile client's connectivity.
- Mobile client only queues offline UI actions (e.g., "tap connect while offline"); it does not own platform sync state.
- Multiple retries do not duplicate activities (idempotency enforced by `activity_sources` unique constraint on `(platform, platform_activity_id)`)
- Acceptance: Backend continues syncing while the mobile app is closed/offline; no data loss or duplication across reconnection events

**Req-NF-8: Fault Tolerance**
- App handles Zwift API errors (500, 503, timeouts) without crashing
- Partial failures (e.g., 50 activities fetched, then timeout) don't corrupt data
- Graceful degradation: if recent sync fails, show last successful sync data
- Acceptance: App remains stable; no crashes on Zwift failures; data consistent

**Req-NF-9: Observability**
- All Zwift API calls logged (without sensitive data: tokens, passwords)
- Sync success/failure metrics tracked (success rate, latency, error types)
- Metrics accessible via app debug menu (not in production UI)
- Acceptance: Support team can troubleshoot using logs; metrics show healthy sync pattern

---

## Data Model

### Entities

> **Note:** The canonical schema lives in `000-backend-foundation` (`activities` + `activity_sources` lossless multi-source model — see architecture-overview AD-2 / AD-4). The entries below describe only the Zwift-specific projections. Token columns are defined by the backend's `oauth_connections` table and are NOT duplicated here.

**Zwift Connection (projection of `oauth_connections` where `platform = 'zwift'`)**
- `id`: UUID (unique connection identifier)
- `user_id`: UUID (FitHub user)
- `athlete_id`: string (Zwift athlete ID, stored in `platform_user_id`)
- `connected_at`: timestamp (when user authorized)
- `last_sync_at`: timestamp (last successful activity fetch)
- `last_sync_status`: enum (success | failed | in_progress)
- (Token material — `access_token`, `refresh_token`, `token_expires_at` — lives only in the backend `oauth_connections` table, AES-256-GCM encrypted, never exposed to the mobile client.)

**Activity Source (Zwift contribution to canonical `activities`)**
- Zwift activities are persisted as rows in the canonical `activity_sources` table with `platform = 'zwift'` and `platform_activity_id = <Zwift activity ID>`.
- Each row carries the raw Zwift payload in `raw_payload` (JSON) for losslessness.
- The deduper (000-AC-5) collapses matching sources into a single canonical `activity` row.

Canonical `activities` fields (subset relevant to Zwift):
- `id`, `user_id`, `type` (ride | run | swim | …), `start_time` (UTC), `duration_seconds`, `distance_m`, `calories`, `elevation_gain_m`, `avg_heart_rate`, `avg_power_w`, `metadata` (JSON: trainer_status, resistance, …), `created_at`, `updated_at`

---

## Acceptance Criteria

- [ ] User can connect Zwift account via OAuth in <5 minutes
- [ ] Access token securely stored and encrypted (AES-256)
- [ ] Token refreshes automatically without user action
- [ ] User's Zwift athlete profile fetches and displays correctly
- [ ] All activities from past 12 months fetch on first sync (<2 min)
- [ ] New activities sync within 30 seconds (delta-based)
- [ ] Activities normalized to FitHub model with zero data loss
- [ ] Connection status visible in app ("Connected since [date]")
- [ ] User can manually trigger sync
- [ ] User can disconnect; all Zwift data deleted
- [ ] Network errors handled gracefully (retry, user-friendly messages)
- [ ] Token revocation tested and verified
- [ ] ≥80% unit test coverage
- [ ] Integration tests pass with Zwift sandbox API
- [ ] E2E tests pass (full connect→fetch→display flow)
- [ ] Security audit confirms OAuth best practices followed
- [ ] No rate limit errors in normal usage
- [ ] Offline sync queueing works (app restart, reboot)
- [ ] GDPR/CCPA compliance verified

---

## Out of Scope

- Real-time webhook sync (polling only for MVP)
- Advanced Zwift metrics (segment times, leaderboard position)
- Zwift social features (clubs, follow athletes)
- Bulk historical data import (one year default)
- Custom Zwift data mappings (future customization feature)

---

## Success Criteria

1. **User Adoption:** At least 10 beta testers successfully connect Zwift within first week
2. **Reliability:** ≥99% sync success rate over 2-week testing period
3. **Performance:** P95 sync latency <2 min (first sync), <30 sec (delta sync)
4. **Security:** Zero vulnerabilities in OAuth implementation; security audit passes
5. **Code Quality:** ≥80% unit test coverage; all integration tests passing
6. **User Satisfaction:** Beta tester feedback indicates "easy to use" (4/5 or higher on usability)

---

## Dependencies & External Integrations

**Zwift API v2:**
- OAuth 2.0 endpoints: `/oauth/authorize`, `/oauth/token`
- Activity endpoints: `/athlete/activities`, `/athlete/profile`
- Rate limits: 600 requests per 15 minutes (standard)
- Authentication: Bearer token in Authorization header
- API documentation: https://developers.zwift.com (assumed public; adjust if different)

---

## Decisions

**Sync Strategy (Approved)**
- **Decision:** Fetch last 3 months of activities on first connection (Option C)
- **Rationale:** Quick onboarding for MVP; future extensibility for paid plans
- **Future:** Paid tier users may have longer lookback (6-12 months or all-time)
- **Impact:** ~5-10 typical user activities in first sync (fast <30 sec), users can manually trigger resync for older data if needed
- **Approved:** 2026-05-05

---

## Terminology

- **OAuth 2.0:** Authorization protocol; user grants FitHub permission to access Zwift data
- **Access Token:** Credential allowing FitHub API calls on behalf of user (short-lived)
- **Refresh Token:** Credential allowing FitHub to get new access token when expired (long-lived)
- **PKCE:** Protocol extension for mobile security; prevents token interception
- **Delta Sync:** Fetching only new/modified data since last sync (vs full sync)
- **Normalization:** Converting platform-specific data to FitHub's canonical format

---

## Related Documents

- **Constitution:** `.specify/memory/constitution.md` (governs this feature)
- **Project Intent:** `docs/project-intent.md` (success criteria, constraints)
- **Tech Architecture:** (To be created)

---

## Status & Sign-Off

- [ ] Product Owner Review: __________________ Date: _______
- [ ] Architecture Review: __________________ Date: _______
- [ ] Ready for Clarification Phase: _________ Date: _______
