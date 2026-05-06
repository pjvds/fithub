# Feature Specification: Strava OAuth Integration

> **Status: SUPERSEDED (2026-05-06).** This Flutter-mobile-oriented OAuth spec is superseded by a future `007-strava-oauth-web` spec that defines the server-driven OAuth + webhook flow used by the v1 Astro web frontend. Retained here for historical context — **do not implement against this spec.**

---

**Feature Name:** Strava OAuth Integration

**Feature ID:** 003-strava-oauth

**Version:** 1.0.0

**Status:** Draft

**Authored By:** Copilot

**Date:** 2026-05-05

---

## Problem Statement

**What problem does this feature solve?**

Strava is one of the largest fitness activity platforms with millions of active users. Currently, FitHub cannot sync activities from Strava, limiting its value to Strava users. By adding Strava OAuth integration, users can contribute their Strava activities to FitHub's cross-platform sync, enabling complete activity consolidation.

**Why now?**

Strava is the primary fitness network for cyclists and runners. Adding Strava support expands FitHub's platform coverage and provides a backup integration path if Zwift becomes difficult to support. Strava's public API is well-documented and stable, making it a lower-risk implementation compared to other platforms.

---

## Proposed Solution

**What is the feature?**

FitHub users can securely authorize Strava access via OAuth 2.0. The FitHub backend then fetches activities (via Strava webhooks for near-real-time updates and a 60-minute reconciliation poll for gap-coverage), normalizes them to FitHub's canonical schema, and persists them in D1 as the source of truth. Mobile clients query the backend API for display and receive push updates.

**User Stories**

```
As a Strava user,
I want to connect my Strava account to FitHub in under 2 minutes,
so that my Strava activities appear alongside other fitness data.

As a power user with multiple fitness platforms,
I want to authorize Strava independently from other platforms,
so that I have granular control over which apps can access my data.

As a user with offline time,
I want FitHub to sync new Strava activities when reconnected,
so that my activity history stays current without manual intervention.
```

---

## User Scenarios

### Scenario 1: Initial Connection (Happy Path)

**Given:** User has active Strava account with workout history

**When:** User taps "Connect Strava" in FitHub settings

**Then:**
1. Browser/native app redirects to Strava OAuth login
2. User authorizes FitHub with read-only scope
3. FitHub backend exchanges authorization code for access token (tokens stored server-side, encrypted; see `000-backend-foundation` AC-1)
4. Backend fetches last 3 months of activities from Strava
5. Backend normalizes activities to canonical schema and persists them in D1
6. Backend pushes connection-status update to mobile (see `000-backend-foundation` AC-6); user sees "Strava connected" confirmation with activity count

**Expected Duration:** <30 seconds (excluding Strava login time)

### Scenario 2: Incremental Sync

**Given:** Strava is already connected, user has been offline

**When:** User opens FitHub after 6 hours offline

**Then:**
1. FitHub checks if new Strava activities exist (delta sync)
2. Fetches only new/modified activities since last sync
3. Merges with existing local data
4. Updates UI with new activity count

**Expected Duration:** <5 seconds

### Scenario 3: Disconnection

**Given:** User wants to revoke Strava access

**When:** User taps "Disconnect Strava" in settings

**Then:**
1. FitHub revokes Strava access token
2. Local Strava activities remain (user can delete manually if desired)
3. Future syncs no longer fetch from Strava
4. Confirmation shown: "Strava disconnected"

**Expected Duration:** <1 second

### Scenario 4: Error Handling

**Given:** Strava API is temporarily unavailable during sync

**When:** FitHub attempts to sync and receives 503 error

**Then:**
1. FitHub queues sync attempt for retry
2. Shows user a subtle notification: "Strava sync will retry in 5 minutes"
3. Retries exponentially (5 min → 15 min → 30 min → 1 hour)
4. Stops retrying after 24 hours
5. User can manually trigger immediate retry

**Expected Duration:** Transparent to user (background process)

---

## Functional Requirements

**FR1: OAuth Authorization Flow**
- Implement PKCE-protected OAuth 2.0 authorization code flow (mobile-initiated, backend-completed)
- Request scopes: `read,activity:read_all` (sufficient for activity retrieval, including private activities)
- Tokens stored server-side only — encrypted in D1 `oauth_connections` (AES-256-GCM, format `v1:iv:ciphertext:tag`). Tokens are never returned to the mobile client. (See `000-backend-foundation` AC-1; same canonical pattern as `002-zwift-oauth` Req-1.)
- Backend `auth` Worker refreshes access tokens automatically 5 minutes before expiration
- Failed refresh triggers user re-authorization prompt via push notification (see `000-backend-foundation` AC-6)

**FR2: Activity Retrieval**
- On first connection: Fetch last 3 months of activities from Strava
- Populate: activity type, distance, duration, calories, elevation, date/time, name, description
- Support paginated API responses (Strava returns max 200 per page)
- Handle large activity histories (>1000 activities) without blocking UI

**FR3: Activity Normalization**
- Map Strava activity types to FitHub canonical format:
  - "Run" → "running"
  - "Ride" → "cycling"
  - "Swim" → "swimming"
  - "Hike" → "hiking"
  - "Walk" → "walking"
  - (Other Strava types → "other")
- Convert units: miles → kilometers, feet → meters
- Extract timezone from activity data for accurate local time display
- Store normalized data in local data model

**FR4: Incremental Sync (Webhook + Reconciliation)**
- Backend registers a Strava webhook subscription per user on connection (Strava Push Subscription API)
- Webhook events received at `worker.fithub.app/webhooks/strava` are processed within 30 seconds (matches `000-backend-foundation` AC-3)
- A 60-minute reconciliation poll (Cloudflare Cron via `scheduler` Worker) covers any webhook gaps and detects modified/deleted activities
- Mobile app does not poll Strava directly; it receives updates via backend push (see `000-backend-foundation` AC-6)

**FR5: Token Management**
- Tokens stored server-side only (see FR1 above and `000-backend-foundation` AC-1)
- Backend `auth` Worker refreshes tokens automatically before expiration
- On user disconnect, backend calls Strava `/oauth/deauthorize`, removes the webhook subscription, and deletes the encrypted token row
- Token revocation endpoint errors handled gracefully (token row deleted regardless; backend logs error for follow-up)

**FR6: Disconnection**
- Mobile UI provides a "Disconnect Strava" button that calls `DELETE /api/connections/strava`
- Backend revokes Strava tokens, removes webhook subscription, deletes encrypted credentials from D1
- Confirmation dialog offers "Keep my Strava activities in FitHub" / "Delete all Strava activities"
- If user chooses "delete": backend removes Strava `activity_sources` rows; canonical `activities` rows are kept if they have other sources (matches Zwift disconnect behaviour and `000-backend-foundation` AC-10)
- Future Strava syncs blocked until re-authorization

---

## Non-Functional Requirements

**NFR1: Performance**
- First sync (3 months): <30 seconds (P95 latency)
- Incremental sync: <5 seconds (P95 latency)
- Activity normalization: <100 ms per activity
- API call timeout: 10 seconds per request

**NFR2: Security & Privacy**
- All tokens encrypted at rest using AES-256
- PKCE prevents OAuth token interception on mobile
- Use HTTPS only for all API communication
- No Strava user IDs or credentials logged
- User-initiated disconnect = immediate token revocation
- Comply with FitHub constitution privacy requirements

**NFR3: Reliability**
- Automatic retry for transient failures (503, 429, timeout)
- Exponential backoff: 5 min → 15 min → 30 min → 1 hour
- Max retry window: 24 hours
- Graceful degradation if Strava API is down (local data still accessible)
- Queue failed syncs for retry, don't discard

**NFR4: Compatibility**
- Support Strava API v3 (current production API)
- Handle API pagination (>200 results per page)
- Graceful handling of deprecated API fields
- Supports activities created from Strava mobile app, web, and third-party integrations

**NFR5: Data Integrity**
- No duplicate activities (deduplicate by Strava activity ID)
- Preserve activity history across app updates
- Handle concurrent sync attempts (serialize to prevent race conditions)
- Validate activity data before storage (e.g., distance > 0, duration > 0)

**NFR6: UX & Error Messages**
- Clear, user-friendly error messages (not API error codes)
- Show activity count after sync completion
- Indicate sync status in UI (syncing, last updated, error)
- Provide manual retry option for failed syncs

---

## Data Model

### Core Entities

**StravaConnection**
- `id`: UUID (unique connection record)
- `strava_user_id`: Integer (Strava user ID)
- `access_token`: String (encrypted)
- `refresh_token`: String (encrypted)
- `token_expires_at`: Timestamp
- `connected_at`: Timestamp
- `last_sync_at`: Timestamp (nullable)
- `is_active`: Boolean

**NormalizedActivity** (extends existing activity model)
- `source_platform`: String = "strava"
- `source_id`: String (Strava activity ID)
- `activity_type`: Enum (running, cycling, swimming, hiking, walking, other)
- `distance_km`: Float
- `duration_seconds`: Integer
- `calories`: Integer (nullable)
- `elevation_m`: Float (nullable)
- `start_time_utc`: Timestamp
- `start_timezone`: String (e.g., "America/New_York")
- `name`: String
- `description`: String (nullable)
- `mapped_from_source`: StravaActivity (raw API data for reference)

### API Integration Points

**Strava OAuth Endpoints**
- Authorization: `https://www.strava.com/oauth/authorize`
- Token Exchange: `https://api.strava.com/v3/oauth/token`
- Token Revocation: `https://api.strava.com/v3/oauth/deauthorize`

**Strava API Endpoints (Read-Only)**
- Athlete Activities: `GET /v3/athlete/activities?per_page=200&page={n}`
- Activity Details: `GET /v3/activities/{id}` (if needed for enrichment)
- Athlete Profile: `GET /v3/athlete` (for verification, optional)

---

## Acceptance Criteria

**AC1: User can connect Strava account**
- [ ] User sees "Connect Strava" button in settings
- [ ] Clicking button initiates OAuth flow
- [ ] Browser/app redirects to Strava OAuth page
- [ ] User authorizes and is redirected back to FitHub
- [ ] Connection confirmed with message "Strava connected (N activities)"

**AC2: Activities are fetched and normalized**
- [ ] First sync retrieves last 3 months of activities
- [ ] Activity count matches Strava (accounting for API pagination)
- [ ] Each activity is mapped to FitHub canonical format
- [ ] Distance converted from miles to kilometers
- [ ] Strava type names mapped correctly (Run → running, Ride → cycling, etc.)

**AC3: Incremental sync works**
- [ ] Second connection fetches only new activities
- [ ] Sync time for 5-10 new activities is <5 seconds
- [ ] Modified activities (name/description) updated in FitHub
- [ ] No duplicate activities created on re-sync

**AC4: Disconnection works**
- [ ] User can disconnect Strava from settings
- [ ] Strava access token is revoked
- [ ] FitHub stops fetching new Strava activities
- [ ] Existing Strava activities remain in history (user can delete if desired)

**AC5: Error handling is robust**
- [ ] Transient API errors (503, 429) trigger automatic retry
- [ ] Permanent errors (401, 403) show user-friendly message
- [ ] Network timeout doesn't crash app
- [ ] Failed sync queued for later retry

---

## Out of Scope

- **Strava segments/leaderboards:** Not synced (read-only activities only)
- **Activity photos:** Not fetched (data minimization)
- **Social features:** Kudos, comments, followers not synced
- **Strava clubs:** Not integrated
- **Write operations:** Cannot create/edit activities in Strava from FitHub (read-only)
- **Strava premium features:** No special handling for Strava+ data
- **Historical API data:** Only fetches from current date backward (not archive)

---

## Success Criteria

**User-Level Outcomes**
- Users can connect Strava in <2 minutes (measured from button tap to confirmation)
- Strava activities appear in FitHub within 30 seconds of first connection
- >95% of synced activities display with complete data (no missing fields)
- User satisfaction: ≥4/5 stars for Strava integration feature

**System-Level Outcomes**
- 99.5% of sync attempts succeed without user intervention
- Average sync latency: 5 seconds (incremental), 25 seconds (first sync)
- Zero unhandled exceptions from Strava API failures
- <0.1% of activities fail normalization (edge cases logged)
- Support burden: <5% of support tickets related to Strava connectivity

**Quality Outcomes**
- ≥80% test coverage for OAuth flow and normalization logic
- All token refresh scenarios tested (success, expiration, failure)
- All activity types and edge cases documented
- Zero token leaks in logs or error messages

---

## Assumptions

- **Strava API Availability:** Strava API remains stable and available (99.5% uptime assumed)
- **User Behavior:** Average user has 50-500 activities in last 3 months (~4-40 per month typical)
- **Device Storage:** Device has ≥500 MB free space (sufficient for 10+ years of activities from all platforms)
- **Network:** User has reliable internet for OAuth redirect and API calls (assumed available at connection time)
- **OAuth Scope:** `read` scope is sufficient (no write operations needed)
- **Token Lifespan:** Strava access tokens valid for ≥1 hour; refresh tokens valid for ≥6 months
- **Activity Immutability:** Strava activities are not frequently deleted (except by user)
- **Timezone Data:** Strava API includes timezone info or location data for accurate local time

---

## Dependencies & Related Features

**Dependencies**
- Apple Health OAuth (separate feature, no technical dependency)
- Zwift OAuth (parallel feature, no technical dependency)
- Local activity storage model (infrastructure, assumed existing)
- Token encryption/decryption utilities (infrastructure)

**Related Features (Future)**
- Strava → Apple Health sync (export activities to Health app)
- Strava → Fitbit integration
- Strava → Garmin integration
- Conflict resolution when same activity synced from multiple platforms

---

## Decisions

**Initial Sync Scope (Approved)**
- **Decision:** Fetch last 3 months of activities on first connection (MVP)
- **Rationale:** Quick onboarding for MVP; future extensibility for paid plans
- **Future:** Paid tier users may have longer lookback (6-12 months or all-time)
- **Impact:** ~5-10 typical user activities in first sync (fast <30 sec), users can manually trigger resync for older data if needed
- **Approved:** 2026-05-05

---

## Terminology

- **OAuth 2.0:** Authorization protocol; user grants FitHub permission to access Strava data
- **PKCE:** Authorization Code flow extension for mobile; prevents token interception attacks
- **Access Token:** Short-lived credential (expires in ~6 hours); used for API calls
- **Refresh Token:** Long-lived credential; used to obtain new access tokens without user re-authorization
- **Delta Sync:** Fetching only new/modified data since last sync (vs full re-fetch)
- **Normalization:** Converting platform-specific data (Strava activity type) to FitHub canonical format
- **Rate Limiting:** Strava limits API calls; FitHub must respect and handle 429 responses
- **HTTPS/TLS:** Encrypted communication protocol; required for all Strava API calls

---

## Glossary & References

- **Strava API Documentation:** https://developers.strava.com/docs/reference/
- **Strava OAuth Flow:** https://developers.strava.com/docs/authentication/
- **OAuth 2.0 Spec:** https://tools.ietf.org/html/rfc6749
- **PKCE Spec:** https://tools.ietf.org/html/rfc7636
- **FitHub Constitution:** `.specify/memory/constitution.md` (Data Privacy & Security, Cross-Platform Integration principles apply)

---

## Constitution Alignment Checklist

**Principle: Data Privacy & Security** ✅
- [ ] Tokens encrypted at rest using AES-256
- [ ] PKCE protects OAuth authorization code from interception
- [ ] No credentials logged or exposed in error messages
- [ ] User-initiated disconnection revokes all access

**Principle: Cross-Platform Integration** ✅
- [ ] Supports 3rd major fitness platform (Strava)
- [ ] Handles Strava API rate limits gracefully (429 responses)
- [ ] Conflict detection ready (same activity from multiple sources)
- [ ] Normalization enables cross-platform data synthesis

**Principle: User Experience & Simplicity** ✅
- [ ] Connection in <2 minutes
- [ ] Clear confirmation after authorization
- [ ] Descriptive error messages (user-friendly, not API codes)
- [ ] Manual retry option visible after failed sync

**Principle: Reliability & Uptime** ✅
- [ ] Offline-first: local activities accessible without Strava
- [ ] Automatic retry with exponential backoff
- [ ] Graceful degradation if Strava API down
- [ ] 99.5% sync reliability target

**Principle: Performance & Real-Time Sync** ✅
- [ ] Incremental sync <5 seconds (P95)
- [ ] Activities available for use immediately after sync
- [ ] No blocking during sync (background process)
- [ ] Push notifications if needed (future enhancement)

**Principle: Code Quality & Testing** ✅
- [ ] ≥80% test coverage for OAuth and normalization
- [ ] All error scenarios covered by tests
- [ ] Mock Strava API for deterministic testing
- [ ] Integration tests with real API (staging environment)

**Principle: Transparency & Communication** ✅
- [ ] User sees which data is accessed (activities only, no profile data)
- [ ] Sync status visible in UI (syncing, last updated, error)
- [ ] Clear indication of connected platforms in settings
- [ ] Transparent retry behavior (user informed of retries)

---

**END OF SPECIFICATION**
