# Implementation Plan: Apple Health Integration

**Feature:** Apple Health Integration (Reference: `.specify/specs/004-apple-health-integration/spec.md`)

**Plan ID:** plan-004-apple-health-integration

**Version:** 1.0.0

**Planned By:** Copilot

**Date:** 2026-05-05

---

## Problem & Approach

**Feature Problem:**
Apple Health is the native fitness data hub on iOS, aggregating activities from Apple Watch, third-party trackers, and fitness apps. Users have fragmented fitness data across multiple apps. By reading from Apple Health, FitHub provides a unified view of all workouts without requiring separate OAuth connections to each platform.

**Implementation Approach:**
Implement read-only HealthKit integration for iOS 12+. Architecture: (1) Permission manager handles HealthKit authorization, (2) Health fetcher queries HKWorkout and HKWorkoutRoute data, (3) Normalizer converts Health types to canonical format, (4) Deduplication engine matches activities across platforms. Different from OAuth integrations (Zwift, Strava)—no external API calls, data stays on device. Reuses normalizer and storage layers but requires iOS-specific HealthKit queries.

---

## Design Decisions & Rationale

**Decision 1: Read-Only HealthKit Access (v1)**
- **Choice:** Request read-only permissions; no write capability to Health
- **Rationale:** MVP simplification; avoids data corruption risk; aligns with user expectations (FitHub aggregates, doesn't create)
- **Constitution Alignment:** Data Privacy & Security (principle of least privilege), User Experience & Simplicity (focused scope)
- **Alternatives Considered:** Read-write (increases complexity, potential conflicts), write-only (doesn't solve the problem)
- **Impact:** Users cannot create Health activities from FitHub; future feature for v2+

**Decision 2: iOS 12+ as Minimum OS (HealthKit Availability)**
- **Choice:** Support iOS 12+ (released 2018); earlier versions not supported
- **Rationale:** iOS 12 introduced major HealthKit improvements; earlier versions have unstable API; covers 99%+ of active iOS users
- **Constitution Alignment:** Reliability & Uptime (stable API version), Code Quality & Testing (consistent behavior)
- **Alternatives Considered:** iOS 11 (unstable HealthKit), iOS 16+ only (cuts off >30% user base)
- **Impact:** App requires iOS 12+ minimum; graceful degradation for earlier OS versions

**Decision 3: Local-Only Data (No Sync to Backend)**
- **Choice:** Store Health workouts locally; do not sync to FitHub backend initially
- **Rationale:** Health data is sensitive; keeping on-device reduces privacy risk; enables offline-first architecture
- **Constitution Alignment:** Data Privacy & Security (minimal data exposure), Reliability & Uptime (works offline)
- **Alternatives Considered:** Sync to backend (increases privacy risk, backend vulnerability), always local (limits future features)
- **Impact:** Each iOS device maintains independent Health activity history; future cloud sync can be added later

**Decision 4: Deduplication Before Display (Not Automatic Deletion)**
- **Choice:** Identify duplicates, show to user, mark in UI; never auto-delete
- **Rationale:** Prevents accidental data loss; user has final say; matches Apple Health philosophy
- **Constitution Alignment:** User Experience & Simplicity (no surprise deletions), Data Privacy & Security (preserve data)
- **Alternatives Considered:** Auto-merge high-confidence duplicates (risky), ignore duplicates (confusing UI)
- **Impact:** Deduplication UI shows "This activity appears in: Health, Strava" with confidence score

**Decision 5: Incremental Sync with Timestamp Tracking**
- **Choice:** Fetch workouts since last_sync_at; track modified workouts via metadata timestamps
- **Rationale:** Health workouts rarely modified; timestamp-based detection efficient; reduces re-fetches
- **Constitution Alignment:** Performance & Real-Time Sync (efficient queries), Reliability & Uptime (consistent state)
- **Alternatives Considered:** Full re-fetch every sync (wasteful), event-based (HealthKit has no webhooks)
- **Impact:** Sync time stays <3 sec even with 1000+ historical activities

**Decision 6: Route Data Optional (GPS Traces)**
- **Choice:** Fetch HKWorkoutRoute if available; gracefully handle missing routes
- **Rationale:** Not all workouts have GPS (gym workouts, treadmill); fetching route is optional enhancement
- **Constitution Alignment:** User Experience & Simplicity (doesn't break without routes), Performance & Real-Time Sync (skips unnecessary queries)
- **Alternatives Considered:** Require route data (fails for indoor workouts), never fetch routes (misses valuable data)
- **Impact:** Outdoor workouts show GPS traces; indoor workouts show summary only

**Decision 7: Separated from Zwift/Strava Pattern (No OAuth)**
- **Choice:** Implement HealthKit integration separately (not via OAuth Manager)
- **Rationale:** HealthKit is permission-based, not OAuth-based; completely different auth model; separate code path cleaner
- **Constitution Alignment:** Code Quality & Testing (correct abstraction), Cross-Platform Integration (different patterns for different platforms)
- **Alternatives Considered:** Force OAuth Manager pattern (awkward fit), unified permission manager (over-engineered)
- **Impact:** Apple Health code isolated; different permission model than Zwift/Strava; cleaner separation of concerns

---

## Architecture & Component Changes

**System Diagram:**

```
┌─────────────────────────────────────────────────────────────────┐
│                      iOS App (Native)                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────────────────────────────┐                   │
│  │  Settings Screen - Data Sources          │                   │
│  │  - Apple Health (iOS 12+)                │                   │
│  │  - Authorization status                  │                   │
│  │  - Activity type toggles                 │                   │
│  └────────┬─────────────────────────────────┘                   │
│           │                                                      │
│  ┌────────▼──────────────────────────────────────────┐          │
│  │     HealthKit Permission Manager                  │          │
│  │  - System permission dialog (HKHealthStore)       │          │
│  │  - Track permission state (authorized/denied)     │          │
│  │  - Re-authorization flow                          │          │
│  └────────┬──────────────────────────────────────────┘          │
│           │                                                      │
│  ┌────────▼──────────────────────────────────────────┐          │
│  │     Health Fetcher (HealthKit Queries)            │          │
│  │  - Query HKWorkout (workouts)                     │          │
│  │  - Query HKWorkoutRoute (GPS data)                │          │
│  │  - Handle permissions, missing routes, etc.       │          │
│  │  - Timestamp-based incremental fetch              │          │
│  └────────┬──────────────────────────────────────────┘          │
│           │                                                      │
│  ┌────────▼──────────────────────────────────────────┐          │
│  │     Normalizer (Shared)                           │          │
│  │  - Map HealthKit types (HKWorkoutType)            │          │
│  │  - Convert units (Joules → kcal)                  │          │
│  │  - Extract timezone                               │          │
│  └────────┬──────────────────────────────────────────┘          │
│           │                                                      │
│  ┌────────▼──────────────────────────────────────────┐          │
│  │     Deduplication Engine (Shared)                 │          │
│  │  - Match Health vs Zwift/Strava activities        │          │
│  │  - Confidence scoring                             │          │
│  │  - Mark duplicates in UI                          │          │
│  └────────┬──────────────────────────────────────────┘          │
│           │                                                      │
│  ┌────────▼──────────────────────────────────────────┐          │
│  │     Local Storage (Shared)                        │          │
│  │  - NormalizedActivity table (+ source=apple_health)          │
│  │  - HealthConnection table (permission tracking)   │          │
│  │  - No retry queue (local data, no API failures)   │          │
│  └───────────────────────────────────────────────────┘          │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
        │
        │ On-device HealthKit queries
        │ (no network calls)
        ▼
    ┌────────────────────┐
    │  iOS Health App    │
    │  - HealthKit DB    │
    │  - User workouts   │
    │  - Apple Watch     │
    │  - Third-party apps│
    └────────────────────┘
```

**Shared Components (Reused from Zwift/Strava):**
- Normalizer (with Apple Health type mappings)
- Activity Storage (NormalizedActivity table)
- Deduplication Engine (new, shared across all platforms)

**New Components:**
- **HealthKit Permission Manager** (`src/integrations/apple-health/permission-manager.ts`): Handles iOS permission dialogs
- **Health Fetcher** (`src/integrations/apple-health/fetcher.ts`): HealthKit queries (HKWorkout, HKWorkoutRoute)
- **Deduplication Engine** (`src/deduplication/engine.ts`): Cross-platform activity matching

**Modified Components:**
- **Settings Screen**: Add "Apple Health" section (authorization, toggle activity types)
- **Activity Storage**: Add `health_connections` table (permission tracking)
- **UI**: Add duplicate detection UI (confidence badge, source indicators)

---

## Technical Details

### Data Model

**HealthConnection**
```sql
CREATE TABLE health_connections (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL UNIQUE,
  authorized_at INTEGER,
  last_sync_at INTEGER,
  is_active BOOLEAN DEFAULT 1,
  authorized_types TEXT (JSON array: ["running", "cycling", ...])
);
```

**Apple Health Type Mapping**
```
HKWorkoutTypeIdentifier.running → running
HKWorkoutTypeIdentifier.cycling → cycling
HKWorkoutTypeIdentifier.swimming → swimming
HKWorkoutTypeIdentifier.walking → walking
HKWorkoutTypeIdentifier.hiking → hiking
[Everything else] → other
```

**Unit Conversions (HealthKit → Canonical)**
- Distance: meters (HKUnit.meter) → km
- Duration: seconds
- Energy: Joules (HKUnit.joule()) → kcal (Joules / 4184)
- Heart rate: bpm (HKUnit.count().unitDividedBy(.minuteUnit()))
- Elevation: meters

### API Contracts (HealthKit Queries)

**HKWorkout Query**
```swift
let predicate = HKQuery.predicateForWorkouts(
  withWorkoutActivityType: HKWorkoutActivityType.running
)
let query = HKSampleQuery(
  sampleType: HKWorkoutType.workoutType(),
  predicate: predicate,
  limit: 1000,
  sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)],
  resultsHandler: { query, samples, error in ... }
)
```

**HKWorkoutRoute Query**
```swift
let routeQuery = HKSampleQuery(
  sampleType: HKSeriesType.workoutRoute(),
  predicate: HKQuery.predicateForObjects(from: workout),
  limit: HKObjectQueryNoLimit,
  sortDescriptors: nil,
  resultsHandler: { query, routes, error in ... }
)
```

### Deduplication Algorithm

**Matching Logic:**
1. For each new Health activity, search for potential matches in other platforms
2. Calculate confidence score based on:
   - Type match (running vs cycling = 0%, running vs running = 100%)
   - Time proximity (±5 min tolerance)
   - Duration similarity (±10% tolerance)
   - Distance similarity (±5% tolerance)
3. Score calculation: `confidence = type_match * time_match * duration_match * distance_match`
4. Thresholds:
   - >85%: Auto-flag as duplicate (user sees "merged")
   - 70-85%: Show to user for confirmation
   - <70%: Separate activities

**Example:**
```
Health:  Cycling, 15:00, 5400s, 42.5km
Strava:  Cycling, 14:58, 5420s, 42.6km
Match: 100% type × 97% time × 99% duration × 99% distance = 95% confidence
Result: Auto-flag as duplicate, user sees single activity with badges
```

---

## Constitution Check

**Principle 1: Data Privacy & Security** ✅
- Read-only access, no credentials exposed, local-only data, user controls permissions

**Principle 2: Cross-Platform Integration** ✅
- Integrates with native iOS platform, deduplication across sources, unified activity view

**Principle 3: User Experience & Simplicity** ✅
- One-tap authorization, automatic sync, clear permission UI, duplicate detection

**Principle 4: Reliability & Uptime** ✅
- Offline-first (all data local), no retry queue needed (no external API), robust permission handling

**Principle 5: Performance & Real-Time Sync** ✅
- Incremental sync <3 sec, background processing, efficient HealthKit queries

**Principle 6: Code Quality & Testing** ✅
- Reuses normalizer, deduplication testable, mock HealthKit data available

**Principle 7: Transparency & Communication** ✅
- Sync status visible, duplicate detection explained, permission requirements clear

---

## Phased Rollout

**Phase 1 (MVP):** HealthKit permissions + 3-month fetch (iOS only)
**Phase 2:** Incremental sync + modified activity detection
**Phase 3:** Deduplication UI + multi-platform conflict resolution (with Zwift + Strava)

---

## Known Limitations & Future Work

**v1 (MVP):**
- iOS only (Apple Health; no Android Health Connect)
- Read-only (cannot create Health activities from FitHub)
- Local-only (no cloud sync)
- Basic deduplication (confidence scoring only)

**v2+ (Future):**
- Android Health Connect integration
- Write capability (export to Health)
- Cloud sync of Health activities (privacy-preserving)
- Advanced deduplication (ML-based matching)
- Heart rate zone analysis from Health data

---

## Next Steps

1. ✅ Plan complete for Apple Health
2. Review all 3 plans (Zwift, Strava, Apple Health)
3. Generate task breakdowns (speckit-tasks)
4. Begin implementation (Phase 1 for each feature)

---

**END OF APPLE HEALTH PLAN**
