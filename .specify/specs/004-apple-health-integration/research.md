# Research: Apple Health Integration

## HealthKit Framework Specifics

### iOS Availability
- **Minimum OS:** iOS 12.0 (released 2018)
- **Coverage:** ~99%+ of active iOS devices (most on iOS 14+)
- **Framework:** `HealthKit.framework` (requires in app capabilities)

### Permission Model (Not OAuth)

**System Permission Dialog:**
- User taps "Connect Apple Health" in FitHub settings
- iOS shows permission dialog (system, not FitHub)
- User grants or denies access to:
  - HKWorkoutTypeIdentifier (workouts)
  - HKWorkoutRoute (GPS data, optional)
- Permission persists until user revokes in Settings → Health → FitHub

**Permission States:**
- `notDetermined`: Never asked
- `sharingDenied`: User said no
- `sharingAuthorized`: User said yes
- `restricted`: Parent control (always fails for child accounts)

---

## HealthKit Data Available

### HKWorkout Object

**Standard Fields:**
```swift
struct HKWorkout {
  let UUID: UUID                    // Unique identifier
  let workoutActivityType: HKWorkoutActivityType
  let startDate: Date
  let endDate: Date
  let duration: TimeInterval        // In seconds
  let totalEnergyBurned: HKQuantity?
  let totalDistance: HKQuantity?
  let metadata: [String: Any]?
  let sourceBundle: String          // App that created it (e.g., "com.apple.health")
}
```

**Optional Fields:**
- `averageHeartRate: HKQuantity?`
- `maximumHeartRate: HKQuantity?`
- `totalSwimmingStrokeCount: HKQuantity?`

### HKWorkoutRoute Object

**GPS Coordinate Data:**
```swift
struct HKWorkoutRoute {
  let UUID: UUID
  let sourceBundle: String
  let samples: [CLLocationCoordinate2D]  // Lat/long points
}
```

**Availability:** Not all workouts have routes (indoor gym workouts, manual entries don't have GPS)

### Unit Conversions

| Data | HealthKit Unit | Canonical | Conversion |
|------|----------------|-----------|-----------|
| Distance | meters | km | / 1000 |
| Energy | Joules | kcal | / 4184 |
| Duration | seconds | seconds | (no conversion) |
| Heart rate | beats/minute | bpm | (no conversion) |
| Elevation | meters | meters | (no conversion) |

---

## Activity Types (HealthKit → Canonical)

```swift
HKWorkoutActivityType.running → "running"
HKWorkoutActivityType.walking → "walking"
HKWorkoutActivityType.hiking → "hiking"
HKWorkoutActivityType.cycling → "cycling"
HKWorkoutActivityType.swimming → "swimming"
HKWorkoutActivityType.openWaterSwimming → "swimming"
HKWorkoutActivityType.elliptical → "other"
HKWorkoutActivityType.stairClimbing → "other"
HKWorkoutActivityType.functionalStrengthTraining → "other"
HKWorkoutActivityType.yoga → "other"
[All others] → "other"
```

---

## Incremental Sync Strategy

### Timestamp Tracking

**Query by Time Predicate:**
```swift
let predicate = HKQuery.predicateForSamples(
  withStart: lastSyncDate,
  end: now,
  options: .strictStartDate
)
```

**Advantages:**
- Efficient (HealthKit indexes by startDate)
- Handles new workouts and modified workouts
- No polling, no missing data

**Challenges:**
- User can edit workouts retroactively (e.g., fix distance from 5 years ago)
- Detection: Compare `metadata["updatedDate"]` if available, else re-fetch all for safety

---

## Deduplication Across Platforms

### Matching Algorithm

**Precision Thresholds:**
```
Type match required: 100% (cycling can't match running)
Time tolerance: ±5 minutes (accounts for clock sync, async upload)
Duration tolerance: ±10% (accounts for measurement variations)
Distance tolerance: ±5% (accounts for GPS accuracy, device differences)
```

**Confidence Score Calculation:**
```
confidence = (
  type_match * 100 +
  time_proximity_score * 30 +
  duration_similarity_score * 20 +
  distance_similarity_score * 20
) / 170  // Normalized to 100

Result:
  >85%: Auto-flag as duplicate
  70-85%: Show user confirmation
  <70%: Separate activities
```

**Example Matches:**
```
Health:  Run, 08:00, 30:00, 5.0km
Strava:  Run, 08:02, 30:15, 5.05km
Score: 100 + 28 + 20 + 20 = 88% → Auto-flagged

Health:  Cycling, 14:00, 60:00, 30.0km
Strava:  Cycling, 14:00, 60:00, 30.0km
Score: 100 + 30 + 20 + 20 = 100% → Perfect match
```

---

## Permission Handling

### User Workflow

1. User taps "Connect Apple Health"
2. System shows dialog: "Allow FitHub to access your workouts?"
3. User taps "Allow"
4. iOS returns permission state
5. FitHub fetches historical workouts (last 3 months)
6. User sees "Apple Health connected (N workouts)"

### Error Scenarios

**Permission Denied:**
- User sees: "FitHub needs access. Go to Settings → Health → FitHub → Allow Workouts"
- Link to Settings provided (iOS 12+: `UIApplication.openSettingsURLString`)
- On next launch, check permission again

**Permission Revoked:**
- User removes FitHub from Health settings
- Next sync attempt fails silently
- Show message: "Apple Health permission revoked. Re-enable in Settings"

**Restricted (Parental Controls):**
- Permission always denied
- Show message: "Apple Health access restricted by parental controls"
- No retry option

---

## Background Sync

### iOS Background Tasks

**API:** BackgroundTasks framework (iOS 13+, recommended for iOS 12 compat)

**Task Scheduling:**
```swift
let request = BGProcessingTaskRequest(identifier: "com.fithub.health-sync")
request.requiresNetworkConnectivity = false  // No network needed (local HealthKit)
request.requiresExternalPower = false        // Can run on battery
try BGTaskScheduler.shared.submit(request)
```

**Frequency:** Every 30 minutes (or on app launch)

**Resilience:** If app killed, iOS reschedules task automatically

---

## Testing Strategy

### Unit Tests

**Mock HealthKit Data:**
```swift
// Create mock workouts for testing
let mockWorkout = HKWorkout(
  activityType: .running,
  start: Date(),
  duration: 1800,
  totalDistance: HKQuantity(unit: HKUnit.meter(), doubleValue: 5000)
)
```

**Coverage:**
- Type mapping (all 20+ types)
- Unit conversion (Joules → kcal)
- Timezone extraction
- Deduplication algorithm (20+ scenarios)

### Integration Tests

**Real HealthKit:**
- Fetch actual workouts from device Health app
- Verify count, types, distances match
- Test permission scenarios

### Manual QA

- Real Apple Watch workouts
- Manually created activities in Health app
- Third-party app activities (Strava exported to Health)
- Permission grant/revoke
- 1000+ historical workouts

---

## Known Limitations

### HealthKit Constraints

1. **No Webhooks:** Can't receive real-time notifications of new workouts; must poll
2. **No Activity Creation:** Can't create workouts in Health from FitHub (v1)
3. **No Heart Rate Granularity:** Can't access individual heart rate samples; only avg/max
4. **No Deletion Events:** Can't detect when user deletes a workout (must compare full history)
5. **Device-Specific:** Data stays on device; no cloud sync by default

### FitHub Constraints (MVP)

1. **iOS Only:** Android Health Connect planned for v2+
2. **Local Only:** No backend sync initially
3. **No Conflict Resolution UI:** Deduplication only flags duplicates, no merge UI in v1
4. **No Export:** Can't write activities back to Health (v1)

---

## Future Extensions (v2+)

1. **Android Health Connect:** Parallel implementation for Android
2. **Write to Health:** Export FitHub activities back to Health app
3. **Heart Rate Analysis:** Display HR zones, trends from Health data
4. **Advanced Deduplication:** ML-based matching (video classification, signature matching)
5. **Cloud Sync:** Sync Health activities to FitHub backend (privacy-preserving)

---

**END OF APPLE HEALTH RESEARCH**
