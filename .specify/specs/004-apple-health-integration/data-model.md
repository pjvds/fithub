# Data Model: Apple Health Integration

## HealthConnection

```sql
CREATE TABLE health_connections (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL UNIQUE,  -- iOS device identifier (stable across reinstalls)
  authorized_at INTEGER,
  last_sync_at INTEGER,
  is_active BOOLEAN DEFAULT 1,
  authorized_types TEXT (JSON array),  -- ["running", "cycling", ...]
  created_at INTEGER,
  updated_at INTEGER
);
```

**Differences from Zwift/Strava:**
- No OAuth tokens (uses iOS permission system)
- No refresh tokens (permission persists indefinitely)
- `device_id` instead of user ID (HealthKit is device-based)
- `authorized_types` tracks user's activity type selection

---

## NormalizedActivity (Extended)

```sql
-- Same as Zwift/Strava, with:
source_platform = 'apple_health'
source_id = HKWorkout.UUID (string representation)
source_bundle = 'com.apple.health' or app bundle that created activity
route_data = GeoJSON FeatureCollection (if GPS available)
```

---

## Deduplication Metadata

**Optional Table for Tracking Duplicates (v2+):**
```sql
CREATE TABLE activity_duplicates (
  id TEXT PRIMARY KEY,
  activity_id_1 TEXT NOT NULL,
  activity_id_2 TEXT NOT NULL,
  confidence_score REAL,  -- 0.0 to 1.0
  source_platform_1 TEXT,
  source_platform_2 TEXT,
  matched_at INTEGER,
  user_resolution TEXT,   -- "merge", "dismiss", "separate"
  FOREIGN KEY (activity_id_1) REFERENCES normalized_activities(id),
  FOREIGN KEY (activity_id_2) REFERENCES normalized_activities(id)
);
```

---

## Query Patterns

**Fetch Health Workouts Since Last Sync:**
```sql
SELECT * FROM normalized_activities
WHERE source_platform = 'apple_health'
  AND updated_at > ?last_sync_at
ORDER BY start_time_utc DESC;
```

**Find Potential Duplicates (Cross-Platform):**
```sql
SELECT na2.* FROM normalized_activities na1
JOIN normalized_activities na2 ON
  na1.activity_type = na2.activity_type
  AND na1.start_time_utc BETWEEN na2.start_time_utc - 300 AND na2.start_time_utc + 300
  AND ABS(na1.duration_seconds - na2.duration_seconds) <= na2.duration_seconds * 0.1
  AND ABS(na1.distance_km - na2.distance_km) <= na2.distance_km * 0.05
WHERE na1.source_platform = 'apple_health'
  AND na2.source_platform != 'apple_health'
ORDER BY (
  (na1.duration_seconds - na2.duration_seconds) / na2.duration_seconds
) ASC;
```

---

**END OF APPLE HEALTH DATA MODEL**
