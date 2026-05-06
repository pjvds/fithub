# Implementation Tasks: Zwift OAuth Integration

**Feature:** Zwift OAuth Integration  
**Feature ID:** feat-002-zwift-oauth  
**Tech Stack:** Flutter (Dart) + SQLite + iOS/Android Keychain/Keystore  
**MVP Scope:** User Stories 1 & 2 (OAuth connection + manual sync)  
**Estimated Effort:** 3-4 weeks (Phase 1-2)

---

## Executive Summary

This tasks list breaks down Zwift OAuth integration into 5 implementation phases:
- **Phase 1: Setup** — Project structure, dependencies, OAuth manager skeleton
- **Phase 2: Foundational** — Secure token storage, normalizer module
- **Phase 3: OAuth Connection (US1)** — User story 1 (connect Zwift account)
- **Phase 4: Manual Sync (US2)** — User story 2 (sync on demand)
- **Phase 5: Polish** — Error handling, logging, observability

**Independent Test Criteria:**
- US1: User completes OAuth flow, token stored, profile fetches
- US2: Manual sync button works, activities appear in UI
- Integration: E2E test from login to activity display

**Parallel Opportunities:**
- Token storage (T008-T010) can run parallel to OAuth UI (T013-T015)
- Normalizer (T024-T026) can be coded independently, tested in isolation
- Error handling (Phase 5) can be coded while testing Phase 3-4

---

## Phase 1: Setup (Foundation)

- [ ] T001 Create Flutter project structure with feature folders in `lib/features/zwift_oauth/`
- [ ] T002 Add dependencies to `pubspec.yaml`: `flutter_appauth`, `sqflite`, `encrypted_shared_preferences`
- [ ] T003 Configure iOS project: Enable HealthKit capability, configure URL schemes for OAuth redirect
- [ ] T004 Configure Android project: Add intent filters, configure OAuth redirect URI
- [ ] T005 Create `.specify/memory/tech-stack-lockdown.md` documenting Flutter + SQLite decisions and platform channels

---

## Phase 2: Foundational (Blocking Prerequisites)

### Token Storage Infrastructure

- [ ] T006 [P] Create `lib/services/token_storage/token_storage.dart` interface for platform-agnostic token management
- [ ] T007 [P] Implement `lib/services/token_storage/keychain_storage.dart` for iOS (uses Keychain AES-256)
- [ ] T008 [P] Implement `lib/services/token_storage/keystore_storage.dart` for Android (uses Keystore AES-256)
- [ ] T009 [P] Add unit tests for token encryption/decryption: `test/services/token_storage_test.dart`
- [ ] T010 Create `lib/models/token_model.dart` with `AccessToken`, `RefreshToken`, `TokenPair` classes

### Shared Normalizer Module

- [ ] T011 Create `lib/services/normalizer/activity_normalizer.dart` base class
- [ ] T012 Create `lib/services/normalizer/zwift_normalizer.dart` (Zwift-specific type mappings)
- [ ] T013 Add unit tests for type mappings: `test/services/normalizer/zwift_normalizer_test.dart`
- [ ] T014 Create `lib/models/normalized_activity.dart` with canonical `WorkoutActivity` class (fields: id, type, start_time, duration, distance, calories)

### Database Schema

- [ ] T015 Create `lib/database/migrations/001_create_zwift_schema.sql` with tables: `zwift_connections`, `normalized_activities`, `sync_retry_queue`
- [ ] T016 Implement `lib/database/database_service.dart` for SQLite init, migrations, queries
- [ ] T017 Add database helper methods in `lib/repositories/zwift_connection_repository.dart`
- [ ] T018 Add unit tests for migrations: `test/database/migrations_test.dart`

---

## Phase 3: OAuth Connection (User Story 1)

**Goal:** User can connect Zwift account via OAuth, token stored securely, athlete profile fetches

**Test Criteria:**
- [ ] User completes OAuth flow in <3 minutes
- [ ] Access token stored in Keychain/Keystore (not plaintext)
- [ ] Refresh token persists securely
- [ ] Athlete profile fetches and displays (name, profile photo URL)
- [ ] Last sync timestamp shows "Connected since [date]"

### OAuth Manager

- [ ] T019 [P] Create `lib/services/oauth/oauth_manager.dart` with PKCE flow implementation
  - Methods: `initiateAuthorizationFlow()`, `exchangeCodeForToken()`, `refreshToken()`, `revokeToken()`
  - PKCE implementation: generate code_verifier, compute code_challenge, store state parameter
- [ ] T020 [P] Create `lib/services/oauth/zwift_oauth_provider.dart` (Zwift-specific endpoints and configuration)
  - OAuth endpoints: `https://www.zwift.com/oauth/authorize`, `https://api.zwift.com/v2/oauth/token`
  - Scopes: `activities:read`, `profile:read`
  - Redirect URI: custom URL scheme (e.g., `fithub://oauth-callback`)

### API Client

- [ ] T021 Create `lib/services/api/zwift_api_client.dart` (HTTP client with token injection)
  - Authorization header: `Authorization: Bearer {access_token}`
  - Automatic token refresh on 401 responses
  - Error handling: 429 rate limit, 503 service unavailable

### Athlete Profile Fetch

- [ ] T022 Create `lib/services/api/athlete_profile_service.dart` with method `fetchAthleteProfile(accessToken)` 
  - API endpoint: `GET /athlete`
  - Fields: athlete_id, name, profile_url, created_at
  - Local caching in SQLite
- [ ] T023 Add unit tests: `test/services/athlete_profile_service_test.dart`

### UI Layer (US1)

- [ ] T024 [P] Create `lib/screens/settings/connected_apps_screen.dart` with "Connect Zwift" button
- [ ] T025 [P] Create `lib/screens/oauth/zwift_oauth_flow_screen.dart` (handles OAuth redirect, shows loading state)
- [ ] T026 Create `lib/widgets/connection_status_widget.dart` (displays "Connected since [date]" or "Not connected")
- [ ] T027 Create connection persistence: `lib/repositories/zwift_connection_repository.dart` 
  - Methods: `saveConnection()`, `getConnection()`, `isConnected()`
- [ ] T028 Add integration test: `test_integration/oauth_connection_flow_test.dart` (OAuth flow + token storage + profile fetch)

---

## Phase 4: Manual Sync (User Story 2)

**Goal:** User can manually trigger sync, activities fetch and display in <1 minute

**Test Criteria:**
- [ ] Manual sync button shows loading state
- [ ] Activities fetch from Zwift API (last 3 months)
- [ ] Activities normalize to FitHub format (no data loss)
- [ ] Last sync timestamp updates
- [ ] Sync completes within 1 minute

### Activity Fetch & Pagination

- [ ] T029 Create `lib/services/api/activity_fetch_service.dart` with method `fetchActivities(accessToken, since)`
  - API endpoint: `GET /athlete/activities?pageSize=200`
  - Pagination handling (batches of 200)
  - Time filter: last 3 months (`since` parameter)
- [ ] T030 Implement batch processing: `lib/services/sync/activity_batch_processor.dart`
  - Stream-based processing (doesn't load all activities into memory)
  - Normalization happens per-batch
  - Database insert per-batch
- [ ] T031 Add unit tests: `test/services/activity_fetch_service_test.dart` (pagination, large datasets)

### Sync Orchestration

- [ ] T032 Create `lib/services/sync/sync_orchestrator.dart` with method `syncActivities(connectionId)`
  - Handles: fetch → normalize → save to DB → update sync timestamp
  - Error handling: retries on transient errors, saves error state
  - Idempotency: duplicate activities not inserted on retry
- [ ] T033 Create `lib/services/sync/sync_state_manager.dart` (tracks sync state: idle, in_progress, completed, failed)
- [ ] T034 Add integration tests: `test_integration/manual_sync_test.dart`

### Sync UI

- [ ] T035 [P] Create `lib/screens/activities/sync_button_widget.dart` (manual sync trigger with loading state)
- [ ] T036 [P] Create `lib/screens/activities/activities_list_screen.dart` (displays normalized activities)
  - Shows: activity name, type, duration, distance, calories
  - Last sync timestamp visible
  - Pull-to-refresh for manual sync
- [ ] T037 Create `lib/repositories/normalized_activity_repository.dart`
  - Methods: `fetchActivities()`, `saveActivities()`, `deleteActivities()`

### Error Handling (Basic)

- [ ] T038 Create `lib/services/sync/error_handler.dart` with method `handleSyncError(error)`
  - Network errors → retry message ("Try again in 5 minutes")
  - Rate limit (429) → backoff message ("Too many requests, retrying...")
  - Auth errors (401) → re-auth prompt ("Session expired, tap to reconnect")
- [ ] T039 Add unit tests: `test/services/error_handler_test.dart`

---

## Phase 5: Polish & Observability

### Retry Queue & Resilience

- [ ] T040 Implement `lib/services/sync/retry_queue_service.dart` with exponential backoff
  - Backoff schedule: 5 min → 15 min → 30 min → 1 hr (max 24-hour window)
  - Persistent queue: saves to SQLite `sync_retry_queue` table
  - Background retry: uses `background_fetch` on app resume
- [ ] T041 Create integration test: `test_integration/retry_queue_test.dart`

### Disconnect & Cleanup

- [ ] T042 Create `lib/services/disconnect_service.dart` with method `disconnect(connectionId)`
  - Revokes token with Zwift API
  - Deletes Zwift data from local database
  - Updates UI to "Not connected"
- [ ] T043 Add integration test: `test_integration/disconnect_test.dart`

### Logging & Observability

- [ ] T044 Add structured logging to all critical paths (OAuth flow, fetch, sync)
  - No token/password logging
  - Include: operation, status, duration, error type
  - Save logs to device (not transmitted)
- [ ] T045 Create `lib/debug/sync_metrics_screen.dart` (debug-only metrics: sync success rate, avg latency, error counts)

### E2E Test

- [ ] T046 Create comprehensive E2E test: `test_e2e/zwift_oauth_e2e_test.dart`
  - Full flow: OAuth connect → fetch activities → display → manual sync → disconnect
  - Tests on real Zwift sandbox API (if available) or mock API
  - Verifies: token security, data normalization, UI state consistency

### Documentation

- [ ] T047 Create `lib/features/zwift_oauth/README.md` with:
  - Architecture overview (OAuth manager → API client → normalizer → DB)
  - How to add a new platform (reference for Strava/Apple Health)
  - Token security notes
  - Debugging tips
- [ ] T048 Update root `README.md` with Zwift OAuth feature documentation

---

## Dependency Graph

```
Phase 1: Setup (foundation)
    ↓
Phase 2: Foundational (blocking)
    ├─→ Token Storage (T006-T010)
    ├─→ Normalizer (T011-T014)
    └─→ Database (T015-T018)
        ↓
        Phase 3: OAuth Connection (User Story 1)
        ├─→ OAuth Manager (T019-T020)
        ├─→ API Client (T021)
        ├─→ Athlete Profile (T022-T023)
        └─→ UI (T024-T027)
            ├─ Integration Test (T028)
            ↓
            Phase 4: Manual Sync (User Story 2)
            ├─→ Activity Fetch (T029-T031) [P] parallel to Phase 3 UI
            ├─→ Sync Orchestrator (T032-T034)
            ├─→ Sync UI (T035-T036) [P] parallel to Activity Fetch
            └─→ Error Handling (T038-T039)
                ↓
                Phase 5: Polish (independent tasks)
                ├─→ Retry Queue (T040-T041) [P]
                ├─→ Disconnect (T042-T043) [P]
                ├─→ Logging (T044-T045) [P]
                ├─→ E2E Test (T046) [P]
                └─→ Documentation (T047-T048) [P]
```

---

## Parallel Execution Strategy

**Week 1:**
- Phase 1 (Setup): 2-3 days
- Phase 2 start: Token Storage + Normalizer (parallel)

**Week 2:**
- Phase 2 finish: Database + tests
- Phase 3 start: OAuth Manager (T019-T020) + Athlete Profile (T022-T023) in parallel

**Week 3:**
- Phase 3 finish: UI + integration test
- Phase 4 start: Activity Fetch (T029-T031) in parallel with Sync UI (T035-T036)

**Week 4:**
- Phase 4 finish: Sync orchestrator + error handling
- Phase 5: All tasks parallel (retry queue, disconnect, logging, E2E, docs)

---

## MVP Acceptance Criteria

- [x] User Story 1: Connect Zwift (OAuth flow, token storage, profile fetch)
- [x] User Story 2: Manual sync (fetch activities, normalize, display)
- [x] All Phase 2 foundational tasks complete
- [x] All Phase 3-4 tasks complete
- [x] Integration test passing (OAuth + sync flow)
- [ ] E2E test on Zwift sandbox (or mock) passing
- [ ] Security audit: token storage verified
- [ ] ≥80% unit test coverage (Phase 3-4)

---

## Blocked/Deferred (Future)

- **Auto-sync every 30 minutes** — Deferred to Phase 4+ (requires background task manager)
- **Advanced retry with webhook** — Out of scope (Zwift doesn't offer webhooks)
- **Advanced Zwift metrics** — Out of scope (MVP focuses on basic sync)

---

**Status:** Ready to implement  
**Last Updated:** 2026-05-05  
**Next Step:** Begin Phase 1 (project setup)
