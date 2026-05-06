# Feature Specification: Apple Health Integration

> **Status: POSTPONED (2026-05-06).** Apple HealthKit is iOS-only and has no web equivalent; with v1 focused on backend + Astro web, this feature cannot be implemented yet. Revisit when a native mobile client is on the roadmap. The architectural design (events, ingestion endpoint, dedup rules) is preserved in `.specify/memory/architecture-overview.md` so reviving this is a small lift. **Do not implement against this spec.**

---

**Feature Name:** Apple Health Integration

**Feature ID:** 004-apple-health-integration

**Version:** 1.0.0

**Status:** Draft

**Authored By:** Copilot

**Date:** 2026-05-05

---

## Problem Statement

**What problem does this feature solve?**

Apple Health is the native fitness data hub on iOS, aggregating activities from thousands of apps (Apple Watch, third-party trackers, fitness apps). Users manually manage multiple apps to stay in sync, leading to data fragmentation and duplicates. By integrating with Apple Health, FitHub can read activities directly from the system source of truth, providing users with a single consolidated view without requiring each platform to be separately connected.

**Why now?**

Apple Health is the de facto standard for iOS fitness data. Many users already have Apple Watch and activities flowing into Health. Early dogfooding with iOS makes sense (simpler ecosystem than Android's fragmented Health Connect landscape). This integration increases FitHub's value proposition: "connect once to Apple Health, see all your fitness data."

---

## Proposed Solution

**What is the feature?**

FitHub users can authorize read-only access to Apple Health on their iOS device. FitHub will read workout activities from Health and normalize them to FitHub's canonical format. Activities from Apple Watch, third-party trackers, and other connected devices will appear in FitHub automatically—without requiring separate OAuth connections.

**User Stories**

```
As an iOS user with Apple Watch,
I want FitHub to read my workouts directly from Health,
so that I see all my activities without connecting to each platform individually.

As a user with activities from multiple sources (Apple Watch, Strava, Zwift),
I want Apple Health to deduplicate activities,
so that the same workout doesn't appear multiple times in FitHub.

As a privacy-conscious user,
I want granular control over which activity types FitHub can read from Health,
so that I share only the data I'm comfortable with.

As a casual fitness user,
I want automatic syncing from Apple Health,
so that I don't need to remember to connect or sync manually.
```

---

## User Scenarios

### Scenario 1: Initial Connection (Happy Path)

**Given:** User has iOS device with Apple Health app installed and workout history

**When:** User navigates to FitHub settings → "Data Sources" → "Apple Health"

**Then:**
1. FitHub requests HealthKit read permissions (system dialog)
2. User authorizes specific activity types (Workout, Route data)
3. System grants FitHub read access to authorized data
4. FitHub queries Health for last 3 months of workouts
5. Mobile client normalizes HealthKit samples to FitHub canonical schema and uploads them to the backend via `POST /api/health/upload`. Backend dedupes against existing activities (see `000-backend-foundation` AC-4 / AC-5) and persists in D1 as the source of truth.
6. User sees "Apple Health connected (N workouts)" confirmation

**Expected Duration:** <30 seconds (excluding system permission dialog)

### Scenario 2: Activity Deduplication

**Given:** User has same workout in multiple sources (e.g., Apple Watch + Strava + Zwift)

**When:** FitHub syncs from both Health and other platforms

**Then:**
1. FitHub identifies potential duplicates (same type, time, duration, distance)
2. Marks duplicates with confidence score
3. User sees activity once in timeline with badge: "This activity appears in: Health, Strava"
4. User can choose which source is "primary" for that activity

**Expected Duration:** Transparent (deduplication runs after all syncs complete)

### Scenario 3: Automatic Background Sync

**Given:** User has Apple Health connected, new workout completed

**When:** User finishes a workout (recorded by Apple Watch or app)

**Then:**
1. Activity saved to Apple Health by the source app
2. FitHub mobile app uses `HKObserverQuery` to receive a real-time HealthKit notification when new workouts are written. On notification, the app fetches new samples and uploads them to `POST /api/health/upload`. Background tasks also re-check on app launch.
3. Backend ingests, normalizes, dedupes, and the new workout appears in FitHub on all of the user's devices via push (see `000-backend-foundation` AC-6)
4. No user action required

**Expected Duration:** <30 seconds after FitHub sync check

### Scenario 4: Permission Revocation

**Given:** User wants to disconnect Apple Health

**When:** User taps "Disconnect Apple Health" in settings

**Then:**
1. FitHub stops reading from Health
2. Existing Health-sourced activities remain in FitHub (preserved)
3. User can delete them manually or they stay for historical reference
4. Confirmation: "Apple Health disconnected—past activities retained"

**Expected Duration:** <1 second

### Scenario 5: Error Handling

**Given:** User denies HealthKit permission or revokes later

**When:** FitHub attempts to read Health but lacks permission

**Then:**
1. FitHub detects permission denied (system returns empty data)
2. Shows notification: "FitHub needs Apple Health access. Enable in Settings → Health → FitHub"
3. Provides direct link to iOS Settings
4. User can re-grant permission without re-connecting

**Expected Duration:** Transparent to user (graceful error handling)

---

## Functional Requirements

**FR1: HealthKit Authorization & Permissions**
- Request read-only permission for `HKWorkoutTypeIdentifier`
- Also request `HKDataTypeIdentifierWorkoutRoute` (GPS data if available)
- Use `HKHealthStore.requestAuthorization()` for iOS 12+ (preferred)
- Handle permission states: authorized, denied, not determined, restricted
- Support iOS 12+ (minimum OS requirement)

**FR2: Workout Retrieval**
- Query Health for workouts from last 3 months on first connection
- Retrieve: workoutActivityType, duration, totalEnergyBurned, totalDistance, startDate, endDate, metadata
- Support paginated queries (process in batches if >1000 results)
- Handle concurrent Health app writes (debounce rapid writes to avoid race conditions)

**FR3: Route Data Retrieval**
- If available, fetch GPS route data (`HKWorkoutRoute`) for workouts with location
- Extract: timestamps, latitude, longitude, altitude
- Normalize to FitHub route format (polyline or coordinate list)
- Skip route fetch if user hasn't authorized location permission

**FR4: Activity Type Mapping**
- Map HealthKit workout types to FitHub canonical format:
  - `HKWorkoutTypeIdentifier.running` → "running"
  - `HKWorkoutTypeIdentifier.cycling` → "cycling"
  - `HKWorkoutTypeIdentifier.swimming` → "swimming"
  - `HKWorkoutTypeIdentifier.walking` → "walking"
  - `HKWorkoutTypeIdentifier.hiking` → "hiking"
  - (Other types → "other")
- Preserve `sourceBundle` (app that created the workout)

**FR5: Activity Normalization & Storage**
- Convert Apple Health units to FitHub canonical:
  - Distance: meters (Health uses meters by default)
  - Duration: seconds
  - Energy: kilocalories (Health uses Joules; convert: Joules / 4184 = kcal)
  - Heart rate: bpm (optional, if available in metadata)
- Extract timezone from device locale (activities are in device time)
- Mark activities with source: "apple_health"
- Store raw Health data for reference (deduplication)

**FR6: Incremental Sync**
- After first connection, fetch only workouts created/modified since last sync (HealthKit `HKAnchoredObjectQuery`)
- Detect modifications and deletions; propagate to backend via `POST /api/health/upload` with status flags
- Sync triggered by: `HKObserverQuery` callback (real-time push from HealthKit), app launch, manual on-demand. **No periodic polling** — HKObserverQuery is push-based, which is more battery-efficient and lower-latency than 30-minute polling.

**FR7: Deduplication Logic**
- Compare activities across platforms using: activity type, start time (±5 min tolerance), duration (±10% tolerance), distance (±5% tolerance)
- If potential duplicate found, generate confidence score (0-100%)
- High confidence (>85%): Auto-merge with user notification
- Medium confidence (70-85%): Show user duplicate UI, ask to confirm/dismiss
- Preserve audit trail: which sources contributed to final activity

**FR8: Permission Management**
- Display current permission status in settings
- Provide link to iOS Settings if permission denied
- Gracefully handle permission denied state (no crash, clear user message)
- Support re-authorization if user denies, then re-enables later

---

## Non-Functional Requirements

**NFR1: Performance**
- First sync (3 months): <15 seconds (P95) - HealthKit is fast locally
- Incremental sync: <3 seconds (P95)
- Activity normalization: <50 ms per activity
- Deduplication: <100 ms per new activity checked

**NFR2: Security & Privacy**
- HealthKit raw samples are read on-device only. Normalized canonical activities are uploaded to the FitHub backend over TLS 1.3 and stored encrypted at rest in D1.
- No HealthKit data is sent to any third party.
- No health data in logs or crash reports
- User has granular control over which activity types are accessible
- Comply with Apple Health privacy guidelines (HIPAA-compliant handling)
- FitHub must declare sensitive data usage in App Privacy Policy

**NFR3: Reliability**
- Handle HealthKit errors gracefully (database locked, permission changes mid-sync)
- Retry mechanism for transient errors (exponential backoff)
- Offline mode: local activities accessible even if HealthKit temporarily unavailable
- Background sync resilient to app termination (use Background Tasks API)

**NFR4: Compatibility**
- Support iOS 12+ (HealthKit availability)
- Future: Android Health Connect (separate phase, not MVP)
- Support multiple HealthKit data sources (Apple Watch, iPhone sensors, third-party apps)
- Graceful degradation if HealthKit data missing (e.g., no GPS data for some workouts)

**NFR5: Data Integrity**
- No duplicate activities from same Health workout (deduplicate by Health sample UUID)
- Preserve workout history across app reinstalls (HealthKit is persistent)
- Handle concurrent sync from multiple app instances (serialize access)
- Validate activity data (duration > 0, start time < end time)

**NFR6: UX & Feedback**
- Sync status indicator in UI (syncing, last updated, error)
- Toast notification after successful sync with activity count
- Clear error messages (not iOS error codes)
- Settings show which activity types are being read
- Manual sync button for user-initiated checks

---

## Data Model

### Core Entities

**HealthConnection**
- `id`: UUID
- `device_id`: String (iOS device identifier, constant across app reinstalls)
- `authorized_at`: Timestamp
- `last_sync_at`: Timestamp (nullable)
- `is_active`: Boolean
- `authorized_types`: Array<String> (e.g., ["running", "cycling", "swimming"])

**NormalizedActivity** (extends existing model)
- `source_platform`: String = "apple_health"
- `source_id`: String (HealthKit sample UUID)
- `source_bundle`: String (app that created workout, e.g., "com.apple.health")
- `activity_type`: Enum (running, cycling, swimming, hiking, walking, other)
- `distance_km`: Float (nullable)
- `duration_seconds`: Integer
- `calories`: Float (nullable, in kcal)
- `heart_rate_avg`: Integer (nullable, bpm)
- `elevation_m`: Float (nullable)
- `start_time_utc`: Timestamp
- `start_timezone`: String (device timezone)
- `name`: String (auto-generated or user-named in Health)
- `route_data`: GeoJSON FeatureCollection (nullable, GPS coordinates if available)
- `metadata`: Dictionary (HealthKit-specific metadata for reference)

### HealthKit Query Points

**HKWorkoutTypeIdentifier**
- Read: HKObjectTypeIdentifierWorkout
- Predicate: `startDate >= (now - 3 months)` for initial sync
- Predicate: `startDate >= lastSyncTime` for incremental sync

**HKRouteData**
- Read: HKObjectTypeIdentifierWorkoutRoute (optional, if authorized)
- Link: `[workout.workoutEvents containsRouteData]` when available

---

## Acceptance Criteria

**AC1: User can authorize Apple Health**
- [ ] Settings shows "Apple Health" option
- [ ] Tapping "Connect" shows system HealthKit permission dialog
- [ ] User can authorize or deny permission
- [ ] Authorization status persists across app restarts

**AC2: Activities are fetched from Health**
- [ ] First sync retrieves all workouts from last 3 months
- [ ] Activity count includes all authorized types (running, cycling, etc.)
- [ ] Each activity maps correctly to FitHub format
- [ ] No duplicate entries (same Health workout only once)

**AC3: Normalization is accurate**
- [ ] Distance converted to kilometers (or meters if <1 km)
- [ ] Duration in seconds
- [ ] Energy converted to kilocalories from Joules
- [ ] Activity types mapped correctly (Apple Watch run → "running", cycle → "cycling")
- [ ] Timezone information preserved for accurate local time

**AC4: Incremental sync works**
- [ ] Second sync fetches only new workouts since first connection
- [ ] Sync time for 3-5 new workouts is <3 seconds
- [ ] Modified workout names updated in FitHub
- [ ] Deleted workouts removed from FitHub

**AC5: Deduplication identifies duplicates**
- [ ] Same workout from Health + Strava shows as one activity
- [ ] Confidence score calculated for potential duplicates
- [ ] User can see which sources contributed
- [ ] No automatic deletion, only flagging

**AC6: Permission changes handled gracefully**
- [ ] If permission denied, show helpful message with Settings link
- [ ] Re-enabling permission allows re-sync
- [ ] Existing activities remain if permission removed

---

## Out of Scope

- **Workout creation in Health from FitHub:** Read-only only (v1)
- **Mindfulness/Meditation data:** Focus on workouts only
- **Heart rate samples outside workouts:** Too granular for MVP
- **Sleep data:** Separate concern (not workout activity)
- **Nutrition/Hydration data:** Out of scope
- **Blood oxygen, ECG, body measurements:** Health metrics, not fitness activities
- **Sharing/social features from Health:** FitHub manages social separately
- **iCloud sync of Health data:** Managed by Apple; FitHub only reads local device data
- **Android Health Connect:** Future phase (v2+)

---

## Success Criteria

**User-Level Outcomes**
- Users can connect Apple Health in <1 minute
- All Apple Watch workouts appear in FitHub automatically
- Users see >95% of their existing Health activities after first sync
- User satisfaction: ≥4/5 stars for Apple Health integration

**System-Level Outcomes**
- 99.9% of synced activities successfully normalized (>500 activities tested)
- Zero unhandled HealthKit permission errors
- Average incremental sync time: 2-3 seconds
- Deduplication catches >90% of true duplicates across platforms

**Quality Outcomes**
- ≥85% test coverage for HealthKit queries and normalization
- All activity type mappings documented and tested
- All permission scenarios (authorized, denied, restricted) tested
- Zero Health data leaks in logs or crash reports
- Privacy policy updated with Health data usage disclosure

---

## Assumptions

- **HealthKit Availability:** Users have Apple Health app available (standard on iOS 8.2+)
- **User Has Workouts:** Typical user has 5-20 workouts per month
- **Device Local Time:** Activities stored in device local time; timezone extracted from device settings
- **Data Freshness:** Health data written by source apps within minutes (not days)
- **Permission Persistence:** Once authorized, HealthKit permission remains until user revokes
- **UUID Stability:** HealthKit sample UUIDs are stable (used for deduplication)
- **No Direct Sharing:** Health data not shared between devices (only on device where created)

---

## Dependencies & Related Features

**Dependencies**
- Zwift OAuth (parallel, no technical dependency)
- Strava OAuth (parallel, no technical dependency)
- Local activity storage model (infrastructure)
- Deduplication engine (shared across all platforms)

**Related Features (Future)**
- Export FitHub activities to Apple Health (write capability)
- Android Health Connect integration (v2)
- Garmin integration (platform integration)
- Data conflict resolution UI

---

## Decisions

**Initial Sync Scope (Approved)**
- **Decision:** Fetch last 3 months of activities from Health on first connection
- **Rationale:** Matches Zwift/Strava MVP scope; quick onboarding
- **Future:** Paid tier or settings could allow longer lookback (all-time sync)
- **Approved:** 2026-05-05

**iOS-Only (v1)**
- **Decision:** Focus on iOS/HealthKit for MVP
- **Rationale:** iOS ecosystem is simpler; Apple Health is native platform
- **Future:** Android Health Connect integration in v2+
- **Approved:** 2026-05-05

---

## Terminology

- **HealthKit:** Apple's native health data framework on iOS
- **HKWorkout:** HealthKit object representing a single workout session
- **HKWorkoutRoute:** GPS route data associated with a workout (optional)
- **Sample UUID:** HealthKit's unique identifier for a data point (stable across syncs)
- **Activity Type:** Category of fitness activity (running, cycling, swimming, etc.)
- **Normalization:** Converting platform-specific data to FitHub canonical format
- **Deduplication:** Identifying and merging duplicate activities from multiple sources
- **Incremental Sync:** Fetching only new/modified data since last sync
- **Background Tasks:** iOS APIs for periodic background sync (not user-initiated)

---

## Glossary & References

- **HealthKit Documentation:** https://developer.apple.com/healthkit/
- **HKWorkout Reference:** https://developer.apple.com/documentation/healthkit/hkworkout
- **HealthKit Privacy Guidelines:** https://developer.apple.com/privacy/
- **FitHub Constitution:** `.specify/memory/constitution.md` (Data Privacy & Security, Reliability & Uptime principles apply)

---

## Constitution Alignment Checklist

**Principle: Data Privacy & Security** ✅
- [ ] Read-only access to HealthKit (no writes to Health)
- [ ] User grants explicit permission via system dialog
- [ ] No health data shared with third parties
- [ ] App Privacy Policy discloses Health data usage (HIPAA compliance)
- [ ] No health data in logs/crash reports
- [ ] User controls which activity types are accessible

**Principle: Cross-Platform Integration** ✅
- [ ] Integrates with native iOS health platform (Apple Health)
- [ ] Supports deduplication across multiple sources (Zwift, Strava, Health)
- [ ] Unified activity view across platforms
- [ ] Preserves source information for audit trail

**Principle: User Experience & Simplicity** ✅
- [ ] Connection in <1 minute
- [ ] Automatic sync after authorization (no manual steps)
- [ ] Clear permission UI (system dialog, settings link)
- [ ] Graceful error messages if permission denied
- [ ] Settings show which activity types are authorized

**Principle: Reliability & Uptime** ✅
- [ ] Offline-first: local HealthKit data accessible without network
- [ ] Handles HealthKit errors gracefully (permission changes, database locked)
- [ ] Retry mechanism for transient errors
- [ ] App continues functioning if Health sync fails
- [ ] Background sync resilient to interruptions

**Principle: Performance & Real-Time Sync** ✅
- [ ] Incremental sync <3 seconds (P95)
- [ ] Activities appear in FitHub within minutes of creation in Health
- [ ] Normalization <50 ms per activity
- [ ] No blocking during sync (background process)

**Principle: Code Quality & Testing** ✅
- [ ] ≥85% test coverage for HealthKit queries and normalization
- [ ] Mock HealthKit for deterministic testing
- [ ] All permission states tested (authorized, denied, restricted)
- [ ] Edge cases covered (empty results, malformed data, concurrent writes)

**Principle: Transparency & Communication** ✅
- [ ] Clear indication of which data is accessed (workouts, GPS routes)
- [ ] Sync status visible in UI (syncing, last updated, error)
- [ ] Source information preserved (workout created by Apple Watch, Strava, etc.)
- [ ] User can see which activity types are authorized in settings

---

**END OF SPECIFICATION**
