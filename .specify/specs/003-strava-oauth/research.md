# Research: Strava OAuth Integration

## Technology Reuse

**Architecture Reuse from Zwift:**
- ✅ OAuth Manager (parametrized by platform: "strava")
- ✅ Normalizer (with Strava type mappings)
- ✅ Sync Orchestrator
- ✅ Token Storage Adapter
- ✅ Background Task Scheduler
- ~80% code reuse reduces risk and time-to-market

**Implementation Effort:** 20% new code (Strava-specific), 80% reused from Zwift

---

## Strava API Specifics

### API v3 Features

**Rate Limiting:** 600 requests per hour (more generous than Zwift's 600/15min)
- Header: `X-RateLimit-Limit: 600`, `X-RateLimit-Usage: 50`
- Burst allowance: Up to 200 requests in first minute of new hour

**Pagination:** Default 30 activities per page (vs Zwift's 200)
- Strava returns fewer per page but more forgiving
- Query parameter: `per_page` (max 200, but 30 recommended for latency)

**Activity Types (30+ types map to 6 canonical):**
```
Run, VirtualRun, Trail Run → running
Ride, VirtualRide, MountainBikeRide, GravelBike Ride → cycling
Swim, OpenWaterSwim → swimming
Hike → hiking
Walk → walking
[Everything else: Workout, Yoga, Strength, Pilates, etc.] → other
```

**Modified Activity Detection:**
- Strava includes `updated_at` field in activity objects
- Fetch activities where `updated_at >= last_sync_time`
- User can edit activity name/description on Strava; FitHub will reflect changes on next sync

### Authentication Flow

**Strava OAuth v2 with PKCE:**
- Redirect URI: Can be custom URL scheme (myapp://oauth) or web callback
- Scopes: `read` (read-only, recommended for MVP)
- Tokens: Access token ~6 hours, Refresh token ~6 months

**Token Endpoints:**
- Authorization: `https://www.strava.com/oauth/authorize`
- Token Exchange: `https://api.strava.com/v3/oauth/token`
- Revocation: `https://api.strava.com/v3/oauth/deauthorize`

---

## Activity Type Mapping Implementation

**Configuration File (reusable pattern):**
```json
{
  "type_mappings": {
    "strava": {
      "Run": "running",
      "VirtualRun": "running",
      "Trail Run": "running",
      "Ride": "cycling",
      ...
    }
  }
}
```

**Advantage:** Easy to add new types or adjust mappings without code changes

---

## Error Handling

| Error | Status | Action |
|-------|--------|--------|
| Timeout | - | Retry (backoff) |
| Service unavailable | 503 | Retry (backoff) |
| Rate limited | 429 | Retry (respect headers) |
| Invalid token | 401 | Re-authorize |
| Scope insufficient | 403 | Request proper scope |

---

## Performance

| Metric | Strava | Zwift | Notes |
|--------|--------|-------|-------|
| API latency (p95) | 500-800ms | 400-600ms | Strava slightly slower |
| Initial sync (3mo) | 20-30 sec | 25-35 sec | Similar (fewer/page offset by latency) |
| Incremental sync | 3-5 sec | 3-5 sec | Modified detection efficient |

---

## Testing Strategy

**Unit Tests:**
- Type mapping (all 30+ types)
- Modified detection algorithm
- API error handling

**Integration Tests:**
- Strava API sandbox (if available)
- OAuth flow with real credentials
- Large dataset (500+ activities)

**Manual QA:**
- Real Strava account
- Verify activity counts
- Check type mappings
- Test rate limiting behavior

---

## Known Gotchas

1. **Activity IDs:** Strava activity IDs are large integers (up to 12 digits); store as 64-bit integers or strings
2. **Timezone Handling:** Strava stores activity time in UTC; extract timezone from metadata if available
3. **Deleted Activities:** Deleted from Strava don't trigger notification; fetch full list, compare against DB, delete missing
4. **Offline Activities:** User-created/imported activities are treated same as device-recorded; no distinction

---

**END OF STRAVA RESEARCH**
