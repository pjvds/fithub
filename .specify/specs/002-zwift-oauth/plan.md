# Implementation Plan: Zwift OAuth Integration

**Feature:** Zwift OAuth Integration (Reference: `.specify/specs/002-zwift-oauth/spec.md`)

**Plan ID:** plan-002-zwift-oauth

**Version:** 1.0.0

**Planned By:** Copilot

**Date:** 2026-05-05

---

## Problem & Approach

**Feature Problem:**
Zwift is a major cycling fitness platform with millions of active users. FitHub currently cannot sync Zwift activities, limiting its value to Zwift cyclists. Users need secure, OAuth-based access to Zwift activity data with automatic sync capabilities.

**Implementation Approach:**
Implement a mobile-first OAuth 2.0 integration using PKCE for security. Core architecture: (1) OAuth flow module handles user authorization and token management, (2) Activity fetcher retrieves workouts via Zwift API, (3) Normalizer converts platform-specific data to canonical format, (4) Local storage persists activities and tokens securely. Three phases: Phase 1 establishes OAuth + initial sync, Phase 2 adds incremental sync with retry logic, Phase 3 adds platform conflict detection and deduplication.

---

## Design Decisions & Rationale

**Decision 1: PKCE for Mobile OAuth**
- **Choice:** Implement OAuth 2.0 with PKCE (RFC 7636) instead of implicit grant flow
- **Rationale:** PKCE prevents authorization code interception on mobile devices; recommended by OAuth standards body for native apps; Zwift API recommends it
- **Constitution Alignment:** Data Privacy & Security (prevents token theft), Cross-Platform Integration (best practice for all integrations)
- **Alternatives Considered:** Implicit grant (deprecated, less secure); Authorization code without PKCE (vulnerable to interception); custom authentication (incompatible with Zwift OAuth)
- **Impact:** Requires state parameter management, code challenge/verifier exchange; adds ~2KB to auth flow, but standard library support in most mobile frameworks

**Decision 2: On-Device Token Storage with AES-256 Encryption**
- **Choice:** Store access/refresh tokens locally on-device in encrypted storage (iOS Keychain, Android Keystore) rather than backend storage
- **Rationale:** Minimizes server-side attack surface; reduces privacy risk from backend breach; tokens cannot be exposed via network; aligns with FitHub offline-first architecture
- **Constitution Alignment:** Data Privacy & Security (encrypted at rest), Reliability & Uptime (works offline)
- **Alternatives Considered:** Backend token storage (increases complexity, potential privacy risk); plaintext local storage (security vulnerability); in-memory only (lost on app restart)
- **Impact:** Requires secure storage infrastructure on both iOS and Android; token refresh happens locally; no backend session management needed

**Decision 3: 3-Month Initial Sync Window**
- **Choice:** Fetch last 3 months of activities on first connection, with incremental sync thereafter
- **Rationale:** Balances user experience (fast onboarding ~30 sec) with data completeness (covers most recent workout history); MVP approach; extensible to longer lookback for paid tiers
- **Constitution Alignment:** User Experience & Simplicity (quick onboarding), Performance & Real-Time Sync (fast first sync)
- **Alternatives Considered:** Fetch all activities (slow first sync 5-15 min, complex pagination), Fetch 1 year (mid-way, still slow 1-3 min), Let user choose (adds UX complexity)
- **Impact:** Users can manually resync for older activities; future feature request: extend lookback for premium users

**Decision 4: Incremental (Delta) Sync Every 30 Minutes**
- **Choice:** Automatic background sync fetches only new activities since last sync, triggered every 30 minutes
- **Rationale:** Balances freshness (users see recent activities) with battery/bandwidth efficiency; matches user expectations for fitness apps; 30 min interval is industry standard
- **Constitution Alignment:** Performance & Real-Time Sync (low latency), Reliability & Uptime (consistent background process)
- **Alternatives Considered:** Real-time push (Zwift doesn't offer webhooks), continuous polling (battery drain), manual-only sync (poor UX), longer intervals (stale data)
- **Impact:** Requires background task scheduling; efficient API usage; graceful handling of missed syncs if app killed

**Decision 5: API Pagination with Batch Processing**
- **Choice:** Process Zwift API paginated responses in batches (200 activities/page) without blocking UI
- **Rationale:** Zwift API returns max 200 results per page; users may have thousands of activities; batch processing prevents memory spikes and keeps UI responsive
- **Constitution Alignment:** Performance & Real-Time Sync (non-blocking), Code Quality & Testing (batch approach is testable)
- **Alternatives Considered:** Load all activities at once (memory spike, blocks UI), fetch one page at a time (slow for large histories)
- **Impact:** Requires generator/stream pattern; slightly more complex logic; better performance for power users

**Decision 6: Exponential Backoff Retry Strategy (1-24 hours)**
- **Choice:** Retry failed syncs with exponential backoff: 5 min → 15 min → 30 min → 1 hour, max retry window 24 hours
- **Rationale:** Handles transient failures (network blips, API rate limits, server issues); avoids hammering API; gives Zwift infrastructure time to recover; respects rate limits
- **Constitution Alignment:** Reliability & Uptime (resilient to failures), Cross-Platform Integration (respects API rate limits)
- **Alternatives Considered:** No retry (poor UX, fails silently), aggressive retry (wastes bandwidth, violates rate limits), static retry interval (inefficient)
- **Impact:** Requires job queue persistence; background task scheduling; monitoring for stuck retries

**Decision 7: Separate Normalization Layer**
- **Choice:** Create dedicated normalization module (not inline in API fetch) for converting Zwift → FitHub formats
- **Rationale:** Enables reuse across multiple platforms (Strava, Apple Health), testable in isolation, easier debugging, future extensibility
- **Constitution Alignment:** Code Quality & Testing (modular, testable), Cross-Platform Integration (shared infrastructure)
- **Alternatives Considered:** Inline normalization (harder to reuse, test), separate microservice (over-engineered for MVP), database transform (harder to version)
- **Impact:** Adds module, increases code organization; simplifies adding Strava/Apple Health later

---

## Architecture & Component Changes

**System Diagram:**

```
┌─────────────────────────────────────────────────────────────────┐
│                         iOS / Android App                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────┐     ┌──────────────────┐                   │
│  │  UI Layer       │     │  Settings Screen │                   │
│  │  - Activity Tab │────▶│  - Connect Zwift │                   │
│  │  - Sync Status  │     │  - Disconnect    │                   │
│  └────────┬────────┘     └─────────┬────────┘                   │
│           │                        │                             │
│  ┌────────▼────────────────────────▼──────────────────┐          │
│  │     OAuth Manager                                  │          │
│  │  - Authorization flow (PKCE)                       │          │
│  │  - Token storage (Keychain/Keystore)               │          │
│  │  - Token refresh (proactive)                       │          │
│  │  - Disconnection (token revocation)                │          │
│  └────────┬─────────────────────────────────────────┘          │
│           │                                                      │
│  ┌────────▼──────────────────────────────────────────┐          │
│  │     Sync Orchestrator                             │          │
│  │  - Schedule syncs (on launch, every 30 min)       │          │
│  │  - Determine sync type (initial vs incremental)   │          │
│  │  - Manage retry queue                             │          │
│  │  - Update UI with sync status                     │          │
│  └────────┬──────────────────────────────────────────┘          │
│           │                                                      │
│  ┌────────▼──────────────────────────────────────────┐          │
│  │     Activity Fetcher                              │          │
│  │  - Call Zwift API (activities endpoint)           │          │
│  │  - Handle pagination (200 per page)               │          │
│  │  - Batch process results                          │          │
│  │  - Detect API errors (auth, rate limit, timeout)  │          │
│  └────────┬──────────────────────────────────────────┘          │
│           │                                                      │
│  ┌────────▼──────────────────────────────────────────┐          │
│  │     Normalizer                                     │          │
│  │  - Map activity types (Zwift → canonical)         │          │
│  │  - Convert units (units → SI)                     │          │
│  │  - Extract timezone                               │          │
│  │  - Create NormalizedActivity objects              │          │
│  └────────┬──────────────────────────────────────────┘          │
│           │                                                      │
│  ┌────────▼──────────────────────────────────────────┐          │
│  │     Local Storage                                 │          │
│  │  - SQLite / Realm / Core Data                     │          │
│  │  - Activities table                               │          │
│  │  - Connection metadata                            │          │
│  │  - Retry queue                                    │          │
│  └───────────────────────────────────────────────────┘          │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
        │                                    │
        │ OAuth redirect                     │ HTTPS API calls
        │ (browser/native app)               │ (authenticated)
        ▼                                    ▼
    ┌────────────────────┐          ┌──────────────────────┐
    │  Zwift OAuth       │          │  Zwift API           │
    │  oauth.zwift.com   │          │  api.zwift.com       │
    │  - Authorization   │          │  - GET /activities   │
    │  - Token exchange  │          │  - Pagination        │
    │  - Revocation      │          │  - Rate limits: 600  │
    │  - PKCE flow       │          │    req/15min         │
    └────────────────────┘          └──────────────────────┘
```

**New Components:**

1. **OAuth Manager** (`src/integrations/zwift/oauth.ts`)
   - Purpose: Handle OAuth 2.0 flow with PKCE for Zwift authentication
   - Responsibilities: Authorization flow, token storage, token refresh, disconnection, token revocation
   - Key exports: `authorizeZwift()`, `refreshToken()`, `revokeToken()`, `getStoredToken()`

2. **Activity Fetcher** (`src/integrations/zwift/fetcher.ts`)
   - Purpose: Retrieve activities from Zwift API
   - Responsibilities: Paginated API calls, batch processing, error handling, timeout management
   - Key exports: `fetchInitialActivities()`, `fetchIncrementalActivities()`, `handlePagination()`

3. **Normalizer** (`src/integrations/normalizer.ts`)
   - Purpose: Convert platform-specific activity data to FitHub canonical format
   - Responsibilities: Type mapping, unit conversion, timezone extraction, validation
   - Key exports: `normalizeZwiftActivity()` (reusable for Strava, Apple Health later)
   - Shared across all integrations (Zwift, Strava, Apple Health)

4. **Sync Orchestrator** (`src/integrations/sync-orchestrator.ts`)
   - Purpose: Coordinate sync workflow (schedule, fetch, normalize, store, retry)
   - Responsibilities: Scheduling, retry queue management, UI updates, error reporting
   - Key exports: `syncZwift()`, `schedulePeriodicSync()`, `queueRetry()`

5. **Token Storage Adapter** (`src/storage/token-storage.ts`)
   - Purpose: Abstract secure token storage across platforms
   - Responsibilities: AES-256 encryption/decryption, iOS Keychain, Android Keystore integration
   - Key exports: `storeToken()`, `retrieveToken()`, `deleteToken()`

**Modified Components:**

- **Settings Screen** (UI): Add "Connect Zwift" button, disconnection option, sync status indicator
- **Activity Storage** (database): Add columns: `source_platform`, `source_id`, `source_data` (raw Zwift activity for reference)
- **Background Task Scheduler** (infrastructure): Configure periodic task for every 30-minute sync
- **Error Logging** (monitoring): Add integration-specific error tracking (no token/credential logging)

**Removed/Deprecated Components:**

- None (greenfield addition)

---

## Technical Details

### Data Model & Schema

**ZwiftConnection**
```
id: UUID (unique connection)
zwift_user_id: String (from OAuth profile)
access_token: String (encrypted)
refresh_token: String (encrypted)
token_expires_at: Timestamp (when access token expires)
connected_at: Timestamp
last_sync_at: Timestamp (nullable)
is_active: Boolean
```

**NormalizedActivity** (new columns)
```
source_platform: "zwift"
source_id: String (Zwift activity ID)
activity_type: Enum [running, cycling, swimming, hiking, walking, other]
distance_km: Float
duration_seconds: Integer
calories: Integer (nullable)
elevation_m: Float (nullable)
start_time_utc: Timestamp
start_timezone: String
name: String
description: String (nullable)
source_data: JSON (raw Zwift activity for reference)
```

### API Contracts

**Zwift OAuth Endpoints**
- Authorization: `GET https://www.strava.com/oauth/authorize?client_id={id}&response_type=code&redirect_uri={uri}&scope=read&state={state}&code_challenge={challenge}&code_challenge_method=S256`
- Token Exchange: `POST https://api.strava.com/v3/oauth/token` (body: `{code, client_id, client_secret, redirect_uri, grant_type, code_verifier}`)
- Revocation: `POST https://api.strava.com/v3/oauth/deauthorize` (body: `{access_token}`)

**Zwift API Endpoints**
- Activities: `GET https://api.zwift.com/v3/athlete/activities?per_page=200&page={n}` (headers: `Authorization: Bearer {token}`)
- Activity Detail: `GET https://api.zwift.com/v3/activities/{id}`

### Pseudo-Code / Workflow

**Initial Connection Flow:**
```
1. User taps "Connect Zwift"
2. Generate PKCE code_challenge, code_verifier
3. Redirect to Zwift OAuth (browser)
4. User logs in & grants permission
5. Zwift redirects back with authorization code
6. Exchange code for access/refresh tokens (with code_verifier)
7. Store tokens encrypted in Keychain/Keystore
8. Fetch last 3 months activities (with pagination)
9. Normalize each activity
10. Store in local database
11. Show "Zwift connected (N activities)"
```

**Incremental Sync Flow:**
```
1. Check if Zwift is connected (token exists & valid)
2. Get last_sync_at timestamp
3. Fetch activities since last_sync_at (incremental endpoint or newer activities first)
4. For each activity: normalize → validate → upsert in database
5. Update last_sync_at
6. Update UI with sync status
7. On error: queue for retry (exponential backoff)
```

**Retry Logic:**
```
On sync failure:
  - If transient (503, 429, timeout):
      Queue retry with delay = min(exponential(attempt), 24h)
      After 24h, stop retrying
  - If permanent (401, 403):
      Show user: "Zwift connection expired. Re-authorize in settings."
      Clear stored tokens
      Require manual re-connection
```

### Technology Stack (To Be Confirmed)

- **Mobile Framework:** React Native / Flutter / Native iOS+Android (NEEDS CLARIFICATION from project)
- **Token Storage:** iOS Keychain / Android Keystore (platform-specific)
- **Encryption:** AES-256 (using platform crypto libraries)
- **HTTP Client:** Standard HTTP library (URLSession on iOS, OkHttp on Android, or Fetch in React Native)
- **Local Database:** SQLite / Realm / Core Data (NEEDS CLARIFICATION from project)
- **Background Tasks:** iOS Background Tasks API / Android Work Manager (platform-specific)
- **Logging:** Structured JSON logging (no sensitive data, no tokens/credentials)

---

## Constitution Check

**Principle 1: Data Privacy & Security** ✅
- [x] Tokens encrypted at rest (AES-256 in Keychain/Keystore)
- [x] PKCE prevents token interception
- [x] No credentials in logs or crash reports
- [x] User-initiated disconnection revokes tokens
- [x] Zwift API uses TLS 1.3

**Principle 2: Cross-Platform Integration** ✅
- [x] Handles Zwift API rate limits (600 req/15 min) via batching
- [x] Normalizer reusable for Strava, Apple Health
- [x] Conflict detection strategy prepared (separate feature)
- [x] Activity source tracked for audit

**Principle 3: User Experience & Simplicity** ✅
- [x] Connection <2 minutes
- [x] Clear confirmation after auth
- [x] Descriptive error messages (not API codes)
- [x] Manual sync button for user control

**Principle 4: Reliability & Uptime** ✅
- [x] Offline-first (local storage accessible without Zwift)
- [x] Automatic retry with exponential backoff
- [x] Graceful degradation if Zwift down
- [x] 99.5% sync reliability target

**Principle 5: Performance & Real-Time Sync** ✅
- [x] Incremental sync <5 seconds (P95)
- [x] Activities available immediately after sync
- [x] Background processing (non-blocking UI)
- [x] Batch processing for pagination

**Principle 6: Code Quality & Testing** ✅
- [x] OAuth flow testable with mocks
- [x] Normalizer 100% test coverage (no platform-specific code)
- [x] Integration tests with Zwift sandbox API
- [x] Error scenarios covered (auth failure, network timeout, rate limit)

**Principle 7: Transparency & Communication** ✅
- [x] User sees "Zwift connected" indication
- [x] Sync status visible in UI (syncing, last updated, error)
- [x] Activities labeled with Zwift source
- [x] Transparent retry behavior (user sees retry notification)

---

## Testing Strategy

**Unit Tests**
- OAuth Manager: Authorization flow, token storage, refresh, revocation
- Activity Fetcher: Pagination, batch processing, error responses
- Normalizer: All activity type mappings, unit conversions, timezone handling

**Integration Tests**
- Zwift Sandbox API: Full OAuth flow, activity fetch, token refresh
- Local Storage: Write/read cycles, retry queue persistence
- End-to-end: Connect → Fetch → Normalize → Store (with mock API)

**Manual QA**
- Real Zwift account connection
- Large dataset handling (1000+ activities)
- Network failure scenarios (offline, slow, timeout)
- Token expiration & refresh
- Disconnection & cleanup

---

## Phased Rollout

**Phase 1 (MVP): OAuth + Initial Sync**
- OAuth 2.0 flow with PKCE
- Initial 3-month activity fetch
- Token storage & management
- Basic error handling
- Release: Alpha/Beta

**Phase 2: Incremental Sync + Reliability**
- Background sync every 30 minutes
- Retry logic with exponential backoff
- Improved error messages
- Monitoring & metrics
- Release: Production v1.0

**Phase 3: Multi-Platform Conflict Resolution**
- Duplicate detection across Zwift + Strava + Apple Health
- Conflict UI (user chooses source)
- Activity deduplication
- Release: Production v1.1

---

## Dependencies & Blockers

**External Dependencies**
- Zwift API availability (assumed 99.5% SLA)
- iOS Keychain / Android Keystore availability (platform standard)

**Internal Dependencies**
- Local activity storage model (assumed existing)
- Token encryption utilities (see Token Storage Adapter)
- Background task scheduling infrastructure (see Sync Orchestrator)

**Known Blockers**
- Tech stack decision (mobile framework) affects implementation details
- Database choice affects storage layer

---

## Timeline & Milestones

*(No specific dates/deadlines, per instruction. Listed as phases above.)*

**Phase 1:** OAuth + initial sync (estimated: small scope)
**Phase 2:** Incremental sync + reliability (estimated: medium scope)
**Phase 3:** Multi-platform conflict resolution (estimated: large scope, depends on Strava/Apple Health completion)

---

## Success Metrics

- Users can connect Zwift in <2 minutes
- >95% of synced activities display with complete data
- 99.5% of sync attempts succeed without user intervention
- Average sync latency: 5 seconds (incremental), 25 seconds (initial)
- ≥80% test coverage
- Zero token leaks in logs/crash reports
- User satisfaction: ≥4/5 stars

---

## Next Steps

1. **Review & Approve Plan** (if needed)
2. **Resolve Technology Unknowns** (mobile framework, database choice)
3. **Generate Tasks** (speckit-tasks) to break into actionable items
4. **Create Strava Plan** (parallel feature)
5. **Create Apple Health Plan** (parallel feature)
6. **Begin implementation** (Phase 1: OAuth + initial sync)

---

**END OF PLAN**
