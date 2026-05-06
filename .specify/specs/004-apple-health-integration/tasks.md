# Implementation Tasks: Apple Health Integration

**Feature:** Apple Health Integration  
**Feature ID:** feat-004-apple-health-integration  
**Tech Stack:** Flutter (Dart) + SQLite + iOS HealthKit (platform channel)  
**Platform:** iOS only (Android Health Connect in v2+)  
**MVP Scope:** User Stories 1 & 2 (Permission → fetch → deduplication)  
**Estimated Effort:** 2-3 weeks (unique iOS implementation, but reuses normalizer + dedup)

---

## Executive Summary

This tasks list implements **local-only** Health integration (no external API, no OAuth). Architecture:
- HealthKit permissions (iOS native dialog)
- Local health data queries via platform channel (Swift)
- Normalizer reuse from Zwift/Strava
- Deduplication engine (cross-platform matching)

**Reuse Components:**
- Normalizer framework — **adapt for HealthKit type mappings**
- Database schema — **reuse `normalized_activities` table**
- Deduplication engine — **NEW shared component (not specific to Health)**
- Error handler — **adapt for HealthKit permission errors**

**Independent Test Criteria:**
- US1: User grants HealthKit permission, activities fetch
- US2: Deduplication engine correctly matches activities (confidence scoring)
- Integration: E2E test from Health permission to activity display with dedup detection

---

## Phase 1: Setup (Foundation)

- [ ] T001 Configure iOS project: Enable HealthKit capability in Xcode
  - Add `com.apple.developer.healthkit` in capabilities
  - Request entitlements in Info.plist
- [ ] T002 Add Flutter HealthKit package to `pubspec.yaml`
  - Package: `health` (pub.dev, 100K+ downloads, maintained)
  - Or custom platform channel if full control needed
- [ ] T003 Create platform channel bridge: `lib/services/health/health_platform_channel.dart`
  - Dart side: async method calls to native (Swift) HealthKit
  - Native side (Swift): `HealthKitBridge.swift` handling HealthKit queries

---

## Phase 2: Foundational (Blocking Prerequisites)

### HealthKit Type Mapping

- [ ] T004 Create `lib/services/normalizer/healthkit_normalizer.dart` (HealthKit type mappings)
  - HealthKit types: HKWorkoutActivityType.running, .walking, .hiking, .cycling, .swimming, etc.
  - Map to 6 canonical: running, cycling, swimming, hiking, walking, other
  - Reference: `.specify/specs/004-apple-health-integration/research.md` for full type list
- [ ] T005 Add unit tests: `test/services/normalizer/healthkit_normalizer_test.dart`
  - Test: ~15 representative types including edge cases
  - Verify: all HealthKit types handled

### Platform Channel (Swift)

- [ ] T006 Create `ios/Runner/HealthKitBridge.swift` (native HealthKit implementation)
  - Initialize HKHealthStore
  - Request workout permissions: `HKWorkoutTypeIdentifier`, `HKWorkoutRoute` (optional)
  - Query method: `func queryWorkouts(since: Date, until: Date) -> [HKWorkout]`
  - Return JSON-serialized workouts to Dart
- [ ] T007 Create `lib/services/health/health_permission_service.dart` (permission requests)
  - Methods: `requestHealthKitPermission()`, `isHealthKitAuthorized()`, `getAuthorizationStatus()`
  - Handles permission dialog, state tracking
- [ ] T008 Add unit tests: `test/services/health/health_permission_test.dart`

### Deduplication Engine (NEW SHARED COMPONENT)

- [ ] T009 Create `lib/services/deduplication/activity_deduplicator.dart` (core matching algorithm)
  - Method: `findDuplicates(activity, candidates) → List<DuplicateMatch>`
  - Confidence scoring: type (0-100%), time proximity (±5 min), duration (±10%), distance (±5%)
  - Thresholds: >85% auto-flag, 70-85% user confirm, <70% separate
- [ ] T010 Create `lib/models/duplicate_match.dart` with fields: confidence_score, match_type, details
- [ ] T011 Add comprehensive unit tests: `test/services/deduplication_test.dart` (20+ scenarios)
  - Test: perfect matches (100%), partial matches (70-85%), non-matches (<70%)
  - Test: edge cases (midnight crossing, DST transitions, GPS error)

### Database Extension

- [ ] T012 Create `lib/database/migrations/002_add_deduplication_schema.sql`
  - New table: `activity_duplicates` (activity_id_1, activity_id_2, confidence_score, resolution)
  - Tracks matched pairs and user resolutions
- [ ] T013 Update `lib/repositories/normalized_activity_repository.dart` to support queries by platform combination
  - Methods: `findActivitiesNearTime(type, time, tolerance)` for dedup matching

---

## Phase 3: Permission & Initial Fetch (User Story 1)

**Goal:** User grants HealthKit permission, FitHub fetches initial activities

**Test Criteria:**
- [ ] Permission dialog appears and is handled correctly
- [ ] User can grant/deny permissions
- [ ] Initial fetch gets last 3 months of workouts
- [ ] Activities normalize to FitHub format

### Permission Request UI

- [ ] T014 [P] Create `lib/screens/health/health_permission_screen.dart` (permission flow)
  - Shows: "FitHub wants to access your Apple Health workouts"
  - Button: "Connect Apple Health" → triggers permission dialog
  - After grant: proceeds to initial fetch
- [ ] T015 [P] Create `lib/screens/settings/data_sources_screen.dart` (shows Health status)
  - Display: "Connected" or "Not connected"
  - If connected: show number of workouts, last sync time
  - Button: "Disconnect Apple Health"

### Initial Fetch

- [ ] T016 Create `lib/services/health/health_activity_fetch_service.dart` with method `fetchActivities(since, until)`
  - Calls platform channel: query HealthKit for workouts in date range
  - Date range: last 3 months from now
  - Returns list of HKWorkout objects (JSON deserialized)
- [ ] T017 Implement `lib/services/sync/health_sync_service.dart`
  - Fetch → normalize → save to DB
  - Reuse sync orchestrator pattern from Zwift
- [ ] T018 Add integration tests: `test_integration/health_initial_fetch_test.dart`

### Connection Status

- [ ] T019 Create `lib/repositories/health_connection_repository.dart`
  - Methods: `saveHealthConnection()`, `getHealthConnection()`, `isHealthConnected()`
  - Store: device_id, last_sync_time, authorized_types (workouts, route data, etc.)
- [ ] T020 Update `lib/widgets/connection_status_widget.dart` to include Apple Health status

---

## Phase 4: Deduplication (User Story 2)

**Goal:** Match activities across Zwift, Strava, and Apple Health; detect duplicates

**Test Criteria:**
- [ ] Deduplicator correctly matches identical activities (100% confidence)
- [ ] Matches partial duplicates (70-85% confidence) and flags for review
- [ ] Non-matches are kept separate (<70% confidence)
- [ ] User can review and resolve matches

### Deduplication Workflow

- [ ] T021 Create `lib/services/sync/deduplication_sync_service.dart`
  - After each platform sync (Zwift, Strava, or Health), run deduplication
  - For each new activity: find candidates from other platforms
  - Score matches, save results to `activity_duplicates` table
- [ ] T022 Create `lib/services/deduplication/dedup_resolver.dart` (resolution logic)
  - High confidence (>85%): auto-flag as "likely duplicate"
  - Medium confidence (70-85%): show in UI for user confirmation
  - Low confidence (<70%): separate activities

### Deduplication UI

- [ ] T023 [P] Create `lib/screens/duplicates/duplicate_review_screen.dart`
  - Display: flagged duplicate pairs with confidence score
  - User actions: "Confirm merge", "Keep separate", "Review details"
  - Shows: side-by-side comparison (time, duration, distance)
- [ ] T024 [P] Update `lib/screens/activities/activities_list_screen.dart` to show dedup status
  - Badge: "Duplicate" (high confidence), "Review" (medium confidence)
  - Detail view shows matched activities
- [ ] T025 Create `lib/repositories/duplicate_repository.dart`
  - Methods: `saveDuplicate()`, `getDuplicates()`, `resolveDuplicate()`

### Integration Tests

- [ ] T026 Add integration test: `test_integration/deduplication_test.dart`
  - Create activities from Zwift, Strava, Health
  - Trigger deduplication
  - Verify confidence scores and flagging

---

## Phase 5: Incremental Sync & Polish

### Incremental Sync

- [ ] T027 Extend `lib/services/health/health_activity_fetch_service.dart` with method `getModifiedActivities()`
  - Query HealthKit for workouts modified since last sync
  - HealthKit includes `creationDate` and `metadataLastModified`
  - Fetch only modified/new activities on subsequent syncs
- [ ] T028 Update `lib/services/sync/health_sync_service.dart` to handle incremental sync
  - Track last sync time in `health_connections.last_sync_at`
  - Reuse sync orchestrator pattern

### Background Sync

- [ ] T029 Extend `lib/services/sync/background_sync_manager.dart` to include Health
  - Schedule Health sync every 30 minutes
  - Reuse retry queue for failed syncs
  - Use iOS BackgroundTasks framework (requires iOS 13+, fallback for iOS 12)

### Disconnect & Cleanup

- [ ] T030 Create `lib/services/disconnect_service.dart` extension for Health
  - Revoke HealthKit permissions via Settings link
  - Delete all Health activities from local DB
  - Update UI to "Not connected"
- [ ] T031 Add integration test: `test_integration/health_disconnect_test.dart`

### Error Handling

- [ ] T032 Extend `lib/services/sync/error_handler.dart` with HealthKit-specific errors
  - Permission denied: "Enable in Settings → Health → FitHub"
  - Permission revoked: "Please re-enable in Settings"
  - HealthKit unavailable: "Apple Health not available on this device"
- [ ] T033 Add unit tests: `test/services/error_handler_test.dart` (HealthKit error scenarios)

### Logging

- [ ] T034 Add structured logging to all critical Health paths
  - Log: permission state, fetch success/failure, dedup results
  - No personal health data in logs

### E2E Test

- [ ] T035 Create E2E test: `test_e2e/health_integration_e2e_test.dart`
  - Full flow: request permission → initial fetch → sync activities → dedup detection
  - Verify: dedup matches real Health workouts correctly

### Documentation

- [ ] T036 Create `lib/features/apple_health_integration/README.md` with:
  - HealthKit permission requirements
  - Type mappings
  - Deduplication algorithm explanation
  - How to test with mock Health data
- [ ] T037 Update root `README.md` with Apple Health feature documentation

---

## Dependency Graph

```
Phase 1: Setup (1-2 days)
    ↓
Phase 2: Foundational (3-4 days)
    ├─→ HealthKit Type Mapping (T004-T005)
    ├─→ Platform Channel (T006-T008)
    └─→ Deduplication Engine (T009-T013) ← NEW SHARED COMPONENT
        ↓
        Phase 3: Permission & Initial Fetch (3-4 days)
        ├─→ Permission UI (T014-T015)
        ├─→ Initial Fetch (T016-T018)
        └─→ Connection Status (T019-T020)
            ├─ Integration Test (T018)
            ↓
            Phase 4: Deduplication (3-4 days) [reuses dedup engine from Phase 2]
            ├─→ Dedup Workflow (T021-T022)
            ├─→ Dedup UI (T023-T024) [P] parallel to Workflow
            └─→ Integration Test (T026)
                ↓
                Phase 5: Polish (2-3 days, all parallel)
                ├─→ Incremental Sync (T027-T028) [P]
                ├─→ Background Sync (T029) [P]
                ├─→ Disconnect (T030-T031) [P]
                ├─→ Error Handling (T032-T033) [P]
                ├─→ Logging (T034) [P]
                ├─→ E2E Test (T035) [P]
                └─→ Documentation (T036-T037) [P]
```

---

## Parallel Execution Strategy

**Option A (Sequential — 7-8 weeks total):**
1. Complete Zwift (Phases 1-5: 4 weeks)
2. Complete Strava (Phases 1-5: 2 weeks)
3. Complete Apple Health (Phases 1-5: 2-3 weeks)

**Option B (Parallel — 4-5 weeks total, RECOMMENDED):**
1. Zwift Phases 1-2 (setup + foundational): 1 week
2. Zwift Phase 3-4 + Strava Phases 1-2 (parallel): 1.5 weeks
3. Zwift Phase 5 + Strava Phase 3-4 + **Health Phases 1-2** (parallel, all three tracks): 2 weeks
4. Strava Phase 5 + **Health Phases 3-4** (parallel): 1.5 weeks
5. **Health Phase 5** (final polish): 0.5 weeks

**Apple Health Parallel Opportunity:**
- Health Phase 2 (deduplication engine) can start as soon as any platform (Zwift/Strava) Phase 2 is done
- The deduplication engine is a shared component benefiting all three platforms
- Early implementation of dedup allows Zwift/Strava to leverage it for cross-platform matching

---

## MVP Acceptance Criteria

- [x] User Story 1: Request HealthKit permission, fetch initial activities
- [x] User Story 2: Deduplication engine correctly scores matches
- [x] All Phase 2 foundational tasks complete
- [x] All Phase 3-4 tasks complete
- [x] Deduplication tested on 20+ scenarios (unit tests)
- [x] Integration test passing (permission → fetch → dedup)
- [x] E2E test on real iOS device passing
- [x] ≥80% unit test coverage (Phase 3-4, Phase 2 dedup engine)

---

## Deduplication Algorithm Details

**Confidence Scoring Formula:**

```
confidence = (
  type_match_score(0-100) * 0.30 +
  time_proximity_score(0-100) * 0.25 +
  duration_similarity_score(0-100) * 0.25 +
  distance_similarity_score(0-100) * 0.20
) / 100
```

**Scoring Breakdown:**

1. **Type Match (30%):**
   - Same type (running vs running): 100%
   - Different type: 0%

2. **Time Proximity (25%):**
   - 0 min apart: 100%
   - 5 min apart: 50%
   - 10+ min apart: 0%

3. **Duration Similarity (25%):**
   - Within 5%: 100%
   - 5-10%: 50%
   - 10%+ apart: 0%

4. **Distance Similarity (20%):**
   - Within 5%: 100%
   - 5-10%: 50%
   - 10%+ apart: 0%

**Examples:**

```
Scenario 1: Perfect Match
  Zwift: Running, 08:00, 30:00, 5.0km
  Health: Running, 08:00, 30:00, 5.0km
  Score: 100 + 100 + 100 + 100 = 100%
  → AUTO-FLAG as duplicate

Scenario 2: Partial Match
  Zwift: Running, 08:00, 30:00, 5.0km
  Health: Running, 08:02, 30:15, 5.05km
  Score: (100*0.30) + (96*0.25) + (99*0.25) + (99*0.20) = 98%
  → AUTO-FLAG as duplicate

Scenario 3: User Review
  Zwift: Running, 08:00, 30:00, 5.0km
  Health: Running, 08:05, 25:00, 4.7km
  Score: (100*0.30) + (75*0.25) + (83*0.25) + (94*0.20) = 86%
  → SHOW USER for confirmation

Scenario 4: Separate Activities
  Zwift: Running, 08:00, 30:00, 5.0km
  Health: Running, 14:00, 30:00, 5.0km
  Score: (100*0.30) + (0*0.25) + (100*0.25) + (100*0.20) = 55%
  → KEEP SEPARATE
```

---

## iOS-Specific Implementation Notes

- **Minimum OS:** iOS 12.0 (HealthKit available)
- **HealthKit Framework:** `import HealthKit`
- **Permissions:** User grants via system dialog; app cannot force access
- **Data Privacy:** Health data stays on-device (no transmission to backend in v1)
- **Background Tasks:** iOS 13+ uses `BGProcessingTaskRequest`; iOS 12 uses legacy background fetch
- **Platform Channels:** Dart ↔ Swift communication via `MethodChannel`

---

**Status:** Ready to implement (after Zwift/Strava Phase 2 complete, or in parallel)  
**Last Updated:** 2026-05-05  
**Next Step:** Begin Phase 1 (iOS capability setup)
