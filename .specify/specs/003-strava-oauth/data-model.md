# Data Model: Strava OAuth Integration

## StravaConnection

```sql
CREATE TABLE strava_connections (
  id TEXT PRIMARY KEY,
  strava_user_id TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL (encrypted),
  refresh_token TEXT NOT NULL (encrypted),
  token_expires_at INTEGER,
  connected_at INTEGER,
  last_sync_at INTEGER,
  is_active BOOLEAN DEFAULT 1,
  created_at INTEGER,
  updated_at INTEGER
);
```

**Mirrors ZwiftConnection schema for consistency.**

---

## Activity Type Mappings

Strava types → FitHub canonical (30+ types):

```
Run, VirtualRun, Trail Run → running
Ride, VirtualRide, MountainBikeRide, GravelBikeRide, EBikeRide → cycling
Swim, OpenWaterSwim → swimming
Hike → hiking
Walk → walking
[All others] → other
```

---

## Query Patterns

**Fetch New/Modified Activities:**
```sql
SELECT * FROM normalized_activities
WHERE source_platform = 'strava'
  AND updated_at > ?last_sync_at
ORDER BY updated_at DESC;
```

**Identify Duplicates (Cross-Platform):**
```sql
SELECT * FROM normalized_activities
WHERE activity_type = ?type
  AND start_time_utc BETWEEN ?start-5min AND ?start+5min
  AND source_platform != 'strava'
ORDER BY ABS(duration_seconds - ?duration) ASC
LIMIT 5;
```

---

**END OF STRAVA DATA MODEL**
