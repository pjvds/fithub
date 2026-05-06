# Data Model: Zwift OAuth Integration

## Entity Definitions

### ZwiftConnection

**Purpose:** Store user's Zwift authorization and connection metadata.

**Schema:**
```sql
CREATE TABLE zwift_connections (
  id TEXT PRIMARY KEY,
  zwift_user_id TEXT NOT NULL,
  access_token TEXT NOT NULL (encrypted),
  refresh_token TEXT NOT NULL (encrypted),
  token_expires_at INTEGER (Unix timestamp),
  connected_at INTEGER (Unix timestamp),
  last_sync_at INTEGER (Unix timestamp, nullable),
  is_active BOOLEAN DEFAULT 1,
  created_at INTEGER (Unix timestamp),
  updated_at INTEGER (Unix timestamp)
);
```

**Fields:**
- `id`: UUID, randomly generated on connection
- `zwift_user_id`: Zwift user identifier (from OAuth profile)
- `access_token`: Short-lived OAuth token (encrypted at rest)
- `refresh_token`: Long-lived token for obtaining new access tokens (encrypted at rest)
- `token_expires_at`: Unix timestamp when access_token expires (UTC)
- `connected_at`: When user first connected Zwift
- `last_sync_at`: When activities were last fetched (nullable before first sync)
- `is_active`: Boolean, false after disconnect
- `created_at`: Record creation timestamp
- `updated_at`: Record update timestamp

**Constraints:**
- `zwift_user_id` unique (one connection per Zwift user)
- `access_token` and `refresh_token` encrypted using AES-256 before storage
- `token_expires_at` must be > current time (for validation)

**Lifecycle:**
1. Created: User taps "Connect Zwift"
2. Active: OAuth flow succeeds, tokens stored
3. Last Sync Updated: Each successful activity fetch
4. Inactive: User disconnects (is_active = false, tokens cleared)

---

### NormalizedActivity

**Purpose:** Store activities synced from Zwift, normalized to FitHub canonical format.

**Schema:**
```sql
CREATE TABLE normalized_activities (
  id TEXT PRIMARY KEY,
  source_platform TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_bundle TEXT,
  activity_type TEXT NOT NULL,
  distance_km REAL,
  duration_seconds INTEGER NOT NULL,
  calories REAL,
  elevation_m REAL,
  heart_rate_avg INTEGER,
  heart_rate_max INTEGER,
  start_time_utc INTEGER (Unix timestamp) NOT NULL,
  start_timezone TEXT,
  name TEXT NOT NULL,
  description TEXT,
  route_data JSON,
  metadata JSON,
  created_at INTEGER (Unix timestamp),
  updated_at INTEGER (Unix timestamp),
  UNIQUE(source_platform, source_id)
);

CREATE INDEX idx_activity_source_id ON normalized_activities(source_platform, source_id);
CREATE INDEX idx_activity_start_time ON normalized_activities(start_time_utc DESC);
CREATE INDEX idx_activity_created_at ON normalized_activities(created_at DESC);
```

**Fields:**
- `id`: UUID, randomly generated per activity
- `source_platform`: "zwift" (for Zwift activities)
- `source_id`: Zwift activity ID (from API response)
- `source_bundle`: Source app bundle ("com.zwift" or similar)
- `activity_type`: Canonical type (running, cycling, swimming, hiking, walking, other)
- `distance_km`: Distance in kilometers (nullable for non-distance activities like strength training)
- `duration_seconds`: Activity duration in seconds (required, always > 0)
- `calories`: Energy expended in kilocalories (nullable)
- `elevation_m`: Total elevation gain in meters (nullable)
- `heart_rate_avg`: Average heart rate in bpm (nullable)
- `heart_rate_max`: Max heart rate in bpm (nullable)
- `start_time_utc`: Unix timestamp (UTC) when activity started
- `start_timezone`: User's timezone during activity (e.g., "America/New_York")
- `name`: Activity name (required, e.g., "Morning Ride")
- `description`: Activity description (nullable, e.g., "Fun workout with friends")
- `route_data`: GeoJSON FeatureCollection with coordinates (nullable)
- `metadata`: Raw Zwift activity data for reference (JSON, for debugging)
- `created_at`: When record was inserted into local DB
- `updated_at`: When record was last updated

**Constraints:**
- `(source_platform, source_id)` unique (prevent duplicates from multiple syncs)
- `duration_seconds` > 0
- `distance_km` >= 0 (if present)
- `start_time_utc` valid Unix timestamp
- `activity_type` must be one of: running, cycling, swimming, hiking, walking, other

**Lifecycle:**
1. Created: Zwift activity fetched and normalized
2. Updated: If Zwift activity name/description changed
3. Deleted: If user deletes from Zwift (detected via absence in next sync)

**Activity Type Mapping (Zwift → Canonical):**
| Zwift Type | Canonical | Notes |
|------------|-----------|-------|
| Cycling | cycling | Most common Zwift activity |
| Running | running | Treadmill or outdoor run |
| Swimming | swimming | Pool or open water |
| Strength | other | Not distance-based |
| Yoga | other | Not distance-based |

---

### SyncRetryQueue

**Purpose:** Store failed syncs for retry with exponential backoff.

**Schema:**
```sql
CREATE TABLE sync_retry_queue (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  sync_type TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  attempt_count INTEGER DEFAULT 0,
  next_retry_at INTEGER (Unix timestamp),
  last_attempted_at INTEGER (Unix timestamp),
  max_attempts INTEGER DEFAULT 12,
  created_at INTEGER (Unix timestamp),
  FOREIGN KEY (connection_id) REFERENCES zwift_connections(id)
);

CREATE INDEX idx_retry_next_at ON sync_retry_queue(next_retry_at);
```

**Fields:**
- `id`: UUID for this retry entry
- `connection_id`: Foreign key to ZwiftConnection
- `sync_type`: "initial" (3-month) or "incremental" (since last sync)
- `error_code`: API error code (e.g., "429", "503", "timeout")
- `error_message`: Human-readable error
- `attempt_count`: Number of retry attempts so far
- `next_retry_at`: Unix timestamp when next retry should occur
- `last_attempted_at`: When this was last attempted
- `max_attempts`: Max retries before giving up (default 12)
- `created_at`: When retry entry was created

**Constraints:**
- `connection_id` must exist in zwift_connections
- `attempt_count` <= `max_attempts`
- `next_retry_at` > current time (unless overdue for retry)

**Lifecycle:**
1. Created: Sync fails with transient error
2. Retried: Background job processes next_retry_at
3. Succeeded: Removed from queue on successful sync
4. Abandoned: After max_attempts reached or 24 hours elapsed

**Exponential Backoff Calculation:**
```
attempt_count = 1 → delay = 5 min
attempt_count = 2 → delay = 15 min (5 * 3)
attempt_count = 3 → delay = 30 min (15 * 2)
attempt_count = 4+ → delay = 1 hour (capped)
next_retry_at = now + delay
Stop retrying if: attempt_count >= max_attempts OR created_at < (now - 24 hours)
```

---

## Relationships & Data Flow

### Connection → Activities (One-to-Many)

```
ZwiftConnection (1)
    ↓
    └─→ NormalizedActivity (Many)
        - Activities linked by source_platform="zwift" + source_id
```

**Constraint:** When ZwiftConnection.is_active = false:
- Activities remain in DB (historical record)
- No new activities fetched
- User can delete manually if desired

### Connection → Retry Queue (One-to-Many)

```
ZwiftConnection (1)
    ↓
    └─→ SyncRetryQueue (Many)
        - Retry entries linked by connection_id
```

**Constraint:** When ZwiftConnection.is_active = false:
- Remaining retry entries abandoned (stop processing)
- Can be cleaned up on next background job

---

## State Transitions

### ZwiftConnection States

```
DISCONNECTED (not in DB)
    ↓ [User taps "Connect Zwift"]
CONNECTING (OAuth in progress)
    ↓ [User authorizes]
CONNECTED (is_active=true)
    ↓ [First sync in progress]
SYNCING
    ↓ [Sync completes or queued for retry]
CONNECTED (is_active=true, last_sync_at set)
    ↓ [Periodic sync every 30 min]
SYNCING
    ↓
CONNECTED
    ↓ [User taps "Disconnect"]
DISCONNECTING (tokens being revoked)
    ↓ [Tokens cleared]
DISCONNECTED (is_active=false)
```

### SyncRetryQueue Entry States

```
QUEUED (next_retry_at <= now)
    ↓ [Background job picks up]
RETRYING (attempt_count++)
    ↓ [API call made]
    ├─→ [Success] → REMOVED (entry deleted)
    ├─→ [Transient Error] → QUEUED (delay calculated, next_retry_at updated)
    └─→ [Permanent Error or Max Attempts] → ABANDONED (removed, logged)
```

---

## Query Patterns

### Fetch All Activities for User

```sql
SELECT * FROM normalized_activities
WHERE source_platform = 'zwift'
ORDER BY start_time_utc DESC;
```

**Use Case:** Display user's timeline

### Fetch Activities Since Last Sync

```sql
SELECT * FROM normalized_activities
WHERE source_platform = 'zwift'
  AND updated_at > ?last_sync_at
ORDER BY start_time_utc DESC;
```

**Use Case:** Detect new/modified activities

### Check for Duplicates Across Platforms

```sql
SELECT * FROM normalized_activities
WHERE activity_type = ?type
  AND start_time_utc BETWEEN ?start-5min AND ?start+5min
  AND ABS(duration_seconds - ?duration) < ?tolerance
  AND source_platform != 'zwift'
ORDER BY ABS(duration_seconds - ?duration) ASC;
```

**Use Case:** Find potential duplicates from other platforms

### Pending Retries (For Background Job)

```sql
SELECT * FROM sync_retry_queue
WHERE next_retry_at <= now
  AND attempt_count < max_attempts
ORDER BY next_retry_at ASC
LIMIT 10;
```

**Use Case:** Background job finds retry-ready entries

---

## Data Validation Rules

### NormalizedActivity Validation

| Field | Rule | Example |
|-------|------|---------|
| activity_type | Must be one of: running, cycling, swimming, hiking, walking, other | ✅ "cycling" |
| duration_seconds | Must be > 0 | ✅ 5400 |
| distance_km | If present, must be >= 0 | ✅ 42.5 |
| start_time_utc | Must be valid Unix timestamp, <= now | ✅ 1699564800 |
| name | Non-empty string, max 255 chars | ✅ "Morning Ride" |

### Deduplication Tolerance

When detecting duplicates across platforms:
- Start time tolerance: ±5 minutes
- Duration tolerance: ±10%
- Distance tolerance: ±5%

Example: Zwift activity vs Strava activity
```
Zwift:  start=15:00, duration=5400s, distance=42.5km
Strava: start=14:58, duration=5420s, distance=42.6km
Match score: 95% (likely same activity)
```

---

## Performance Considerations

### Indices

- **idx_activity_source_id**: Fast lookup by (platform, source_id) for upserts
- **idx_activity_start_time**: Fast range queries for date filtering
- **idx_activity_created_at**: Fast queries for recent activities
- **idx_retry_next_at**: Fast lookup for retry-ready entries

### Expected Data Volume

- User with 500 activities: ~500 KB (SQLite compressed)
- User with 10 years history (5000 activities): ~5 MB
- Database page size: 4 KB
- Expected growth: ~10-50 activities per user per month

### Optimization Strategies

1. **Archival:** Move activities older than 2 years to archive table (optional)
2. **Compression:** Store raw metadata as compressed JSON
3. **Batch Inserts:** Upsert 100 activities at once (not one-by-one)
4. **Index Maintenance:** Rebuild indices after large imports

---

## Migration Strategy (For Future Platforms)

When adding Strava or Apple Health:

1. Keep `normalized_activities` table shared (all platforms)
2. Create platform-specific tables as needed:
   - `strava_connections` (similar to `zwift_connections`)
   - `apple_health_connections` (similar)
3. Activities marked with `source_platform` for filtering/deduplication
4. Retry queue remains shared (all syncs go through same queue)

This design enables:
- Cross-platform activity deduplication
- Unified activity timeline
- Platform-agnostic retry logic

---

**END OF DATA MODEL**
