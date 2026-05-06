# Implementation Tasks: Strava OAuth Integration

**Feature:** Strava OAuth Integration  
**Feature ID:** feat-003-strava-oauth  
**Tech Stack:** Flutter (Dart) + SQLite + shared Zwift infrastructure  
**MVP Scope:** User Stories 1 & 2 (OAuth connection + manual sync)  
**Estimated Effort:** 1.5-2 weeks (reuses 80% from Zwift)

---

## Executive Summary

This tasks list reuses **80% of Zwift OAuth infrastructure** (OAuth Manager, Normalizer, Sync Orchestrator). New work focuses on Strava-specific adapter: API endpoints, type mappings, error handling.

**Key Reuse Components:**
- Token storage (iOS Keychain, Android Keystore) — **reuse from Zwift (T006-T010)**
- Normalizer framework — **reuse from Zwift (T011-T014)**
- Database schema — **reuse `normalized_activities` table from Zwift (T015-T016)**
- Sync orchestrator — **reuse from Zwift (T032-T034)**
- OAuth Manager framework — **extend from Zwift, add Strava provider**

**Independent Test Criteria:**
- US1: User completes Strava OAuth, token stored, athlete profile fetches
- US2: Manual sync fetches Strava activities, normalizes correctly (Strava type mappings)
- Integration: E2E test from Strava login to activity display

---

## Phase 1: Setup (Foundation)

- [ ] T001 Add Strava OAuth configuration to `.specify/memory/tech-stack-lockdown.md`
- [ ] T002 Configure iOS URL schemes for Strava redirect URI in `ios/Runner/Info.plist`
- [ ] T003 Configure Android intent filters for Strava redirect URI in `android/app/src/main/AndroidManifest.xml`

---

## Phase 2: Foundational (Blocking Prerequisites)

### Strava-Specific Normalizer

- [ ] T004 Create `lib/services/normalizer/strava_normalizer.dart` (Strava type mappings)
  - Strava types: Run, VirtualRun, Ride, VirtualRide, MountainBikeRide, Swim, Hike, Walk, [30+ others]
  - Map to 6 canonical: running, cycling, swimming, hiking, walking, other
  - Reference: `.specify/specs/003-strava-oauth/research.md` for full type list
- [ ] T005 Add unit tests for Strava type mappings: `test/services/normalizer/strava_normalizer_test.dart`
  - Test: ~15 representative types including edge cases
  - Verify: no unmapped types, all 30+ types covered in mapping

### Strava API Configuration

- [ ] T006 Create `lib/services/oauth/strava_oauth_provider.dart` (Strava-specific OAuth config)
  - OAuth endpoints: `https://www.strava.com/oauth/authorize`, `https://api.strava.com/v3/oauth/token`
  - Scopes: `activity:read` (read-only)
  - Redirect URI: custom URL scheme (e.g., `fithub://strava-oauth-callback`)
  - Rate limits: 600 requests/hour (more generous than Zwift)
- [ ] T007 Create `lib/services/api/strava_api_client.dart` (Strava API wrapper)
  - Base URL: `https://api.strava.com/v3`
  - Headers: `Authorization: Bearer {access_token}`
  - Rate limit handling: extract `X-RateLimit-*` headers, throttle if approaching limit

---

## Phase 3: OAuth Connection (User Story 1)

**Goal:** User can connect Strava account via OAuth, token stored securely, athlete profile fetches

**Test Criteria:**
- [ ] User completes Strava OAuth in <2 minutes
- [ ] Access token stored in Keychain/Keystore (not plaintext)
- [ ] Athlete profile fetches (name, avatar URL, follower count)
- [ ] UI shows "Connected to Strava since [date]"

### OAuth Integration

- [ ] T008 Extend `lib/services/oauth/oauth_manager.dart` to support Strava provider
  - Add Strava provider selection logic
  - Reuse PKCE implementation
- [ ] T009 Add unit tests: `test/services/oauth/strava_oauth_test.dart`

### Athlete Profile Fetch

- [ ] T010 Create `lib/services/api/strava_athlete_profile_service.dart` (Strava profile endpoint)
  - API endpoint: `GET /athlete`
  - Fields: id, firstname, lastname, profile_medium, profile, city, state, city_country, follower_count, friend_count
  - Local caching in SQLite (same `zwift_connections` table structure but `source = 'strava'`)
- [ ] T011 Add unit tests: `test/services/strava_athlete_profile_service_test.dart`

### UI Integration

- [ ] T012 [P] Extend `lib/screens/settings/connected_apps_screen.dart` with "Connect Strava" button
  - Reuse OAuth flow screen (T013)
  - Display Strava-specific profile info
- [ ] T013 [P] Extend `lib/screens/oauth/oauth_flow_screen.dart` to handle Strava redirects
  - Parametrized by provider (zwift | strava)
- [ ] T014 Extend `lib/repositories/connection_repository.dart` to handle Strava connections
  - Methods: `saveStravaConnection()`, `getStravaConnection()`, etc.
  - Reuse storage layer (Keychain/Keystore)
- [ ] T015 Add integration test: `test_integration/strava_oauth_connection_test.dart`

---

## Phase 4: Manual Sync (User Story 2)

**Goal:** User can manually sync Strava activities, normalize correctly, display in <1 minute

**Test Criteria:**
- [ ] Manual sync fetches Strava activities (last 3 months)
- [ ] Activities normalize correctly with Strava type mappings
- [ ] Last sync timestamp updates
- [ ] Sync completes within 1 minute (faster than Zwift due to fewer activities per page)

### Activity Fetch & Pagination

- [ ] T016 Create `lib/services/api/strava_activity_fetch_service.dart`
  - API endpoint: `GET /athlete/activities?per_page=200&after={since_timestamp}`
  - Strava uses `after` (Unix timestamp) instead of date filter
  - Pagination: default 30 per page, max 200
  - Time filter: last 3 months (convert to Unix timestamp)
- [ ] T017 Update `lib/services/sync/activity_batch_processor.dart` to support Strava normalization
  - Reuse batch processing from Zwift
  - Pass Strava normalizer for this platform
- [ ] T018 Add unit tests: `test/services/strava_activity_fetch_service_test.dart`

### Sync Orchestration (Reuse)

- [ ] T019 Extend `lib/services/sync/sync_orchestrator.dart` to support Strava
  - Parametrize by `source_platform: 'zwift' | 'strava'`
  - Reuse: fetch → normalize → save → update timestamp
  - Reuse: error handling, idempotency checks

### Modified Activity Detection

- [ ] T020 Extend `lib/services/api/strava_activity_fetch_service.dart` with method `getModifiedActivities()`
  - Strava includes `updated_at` field on activity objects
  - Fetch activities where `updated_at >= last_sync_time`
  - Detects user edits (name, description changes) on Strava
- [ ] T021 Add unit tests: `test/services/strava_activity_fetch_service_test.dart` (modified detection)

### Sync UI (Reuse)

- [ ] T022 [P] Extend `lib/screens/activities/sync_button_widget.dart` to show sync status for both Zwift and Strava
  - Display separate "Sync Zwift" and "Sync Strava" buttons
- [ ] T023 [P] Reuse `lib/screens/activities/activities_list_screen.dart` (filters by source platform)
  - Add filter: "All", "Zwift", "Strava", "Apple Health"
- [ ] T024 Reuse `lib/repositories/normalized_activity_repository.dart` (no changes needed)

### Error Handling

- [ ] T025 Extend `lib/services/sync/error_handler.dart` with Strava-specific errors
  - Rate limit handling: Strava returns 429 when >600 req/hr
  - Token errors: Strava returns different error messages than Zwift
  - Map Strava errors to user-friendly messages
- [ ] T026 Add unit tests: `test/services/error_handler_test.dart` (Strava error scenarios)

---

## Phase 5: Polish & Observability

### Retry Queue (Reuse)

- [ ] T027 Extend `lib/services/sync/retry_queue_service.dart` to track Strava failures
  - Reuse exponential backoff logic
  - Store `source_platform: 'strava'` in retry queue

### Disconnect & Cleanup (New)

- [ ] T028 Create `lib/services/disconnect_service.dart` with support for Strava
  - Revokes Strava token: `POST /oauth/deauthorize`
  - Deletes Strava data from local database (via `source_platform = 'strava'` filter)
- [ ] T029 Add integration test: `test_integration/strava_disconnect_test.dart`

### Logging (Reuse)

- [ ] T030 Extend logging in Phase 4 tasks to include Strava API calls
  - Log: operation, status, duration, error type (same pattern as Zwift)

### E2E Test

- [ ] T031 Create E2E test: `test_e2e/strava_oauth_e2e_test.dart`
  - Full flow: OAuth connect → fetch activities → display → manual sync → disconnect
  - Test on Strava sandbox API (if available) or mock API
  - Verify: type mappings, pagination, rate limit handling

### Documentation

- [ ] T032 Update `lib/features/zwift_oauth/README.md` to reference Strava
  - Add: "How to add a new OAuth platform" section (reference Strava as example)
- [ ] T033 Create `lib/features/strava_oauth/README.md` with Strava-specific details
  - Strava API quirks, type mappings, rate limiting

---

## Dependency Graph

```
Phase 1: Setup (quick, 1 day)
    ↓
Phase 2: Foundational (2-3 days)
    ├─→ Strava Normalizer (T004-T005)
    └─→ Strava API Config (T006-T007)
        ↓
        Phase 3: OAuth Connection (3-4 days) [reuses Zwift OAuth Manager]
        ├─→ OAuth Integration (T008-T009)
        ├─→ Athlete Profile (T010-T011)
        └─→ UI (T012-T014)
            ├─ Integration Test (T015)
            ↓
            Phase 4: Manual Sync (3-4 days) [reuses Zwift sync infrastructure]
            ├─→ Activity Fetch (T016-T018) [P] parallel to Phase 3 UI
            ├─→ Sync Orchestrator (T019)
            ├─→ Modified Detection (T020-T021)
            ├─→ Sync UI (T022-T023) [P] parallel to Activity Fetch
            └─→ Error Handling (T025-T026)
                ↓
                Phase 5: Polish (2-3 days, all parallel)
                ├─→ Retry Queue (T027)
                ├─→ Disconnect (T028-T029) [P]
                ├─→ Logging (T030) [P]
                ├─→ E2E Test (T031) [P]
                └─→ Documentation (T032-T033) [P]
```

---

## Parallel Execution with Zwift

**Opportunity:** Once Zwift Phase 2 (Foundational) is complete, Strava can start immediately in parallel:

```
Week 1-2: Zwift Phase 1-2 (Setup + Foundational)
    ↓
Week 2+: START Strava Phase 1-2 (Setup + Foundational) IN PARALLEL
    ↓
Week 2-3: Zwift Phase 3-4 (OAuth + Sync)
    ↓
Week 3: START Strava Phase 3-4 IN PARALLEL (leveraging Zwift components)
```

This reduces total project time from 5-6 weeks to ~4 weeks.

---

## MVP Acceptance Criteria

- [x] User Story 1: Connect Strava (OAuth flow, token storage, profile fetch)
- [x] User Story 2: Manual sync (fetch activities, normalize, display)
- [x] All Phase 2 foundational tasks complete
- [x] All Phase 3-4 tasks complete
- [x] Strava type mapping covers all 30+ types
- [x] Integration test passing (OAuth + sync flow)
- [x] E2E test on Strava sandbox (or mock) passing
- [x] ≥80% unit test coverage (Phase 3-4)

---

## Reuse Summary

| Component | From Zwift | Adapted for Strava |
|-----------|------------|-------------------|
| Token Storage | Yes (T006-T010) | No changes needed |
| Normalizer Framework | Yes (T011-T014) | Strava type mappings (T004-T005) |
| OAuth Manager | Yes (T019-T020) | Add Strava provider (T008) |
| API Client | Yes (T021) | Strava endpoints (T007) |
| Database Schema | Yes (T015-T016) | No changes needed |
| Sync Orchestrator | Yes (T032-T034) | Parametrize by platform (T019) |
| Error Handler | Yes (T038-T039) | Strava error codes (T025-T026) |
| Retry Queue | Yes (T040-T041) | Filter by platform (T027) |

**Code Reuse Rate:** ~80% (15 tasks reused, 9 tasks new)

---

**Status:** Ready to implement (after Zwift Phase 2 complete)  
**Last Updated:** 2026-05-05  
**Next Step:** Begin Phase 1 (platform configuration)
