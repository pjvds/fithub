# Implementation Plan: Strava OAuth Integration

**Feature:** Strava OAuth Integration (Reference: `.specify/specs/003-strava-oauth/spec.md`)

**Plan ID:** plan-003-strava-oauth

**Version:** 1.0.0

**Planned By:** Copilot

**Date:** 2026-05-05

---

## Problem & Approach

**Feature Problem:**
Strava is one of the largest fitness networks with millions of cyclists and runners. FitHub currently cannot sync Strava activities. Users want to consolidate Strava workouts with activities from other platforms in a single app.

**Implementation Approach:**
Implement Strava OAuth 2.0 integration with PKCE, similar architecture to Zwift but leveraging Strava's well-documented public API. Core flow: (1) OAuth authorization and token management, (2) Activity fetcher for Strava API pagination, (3) Activity type normalization (Run → running, Ride → cycling), (4) Local storage with same retry logic as Zwift. Strava offers a more mature API than Zwift with better documentation, reducing integration risk. Can reuse 80% of Zwift implementation (OAuth Manager, Normalizer, Sync Orchestrator) with Strava-specific adapters.

---

## Design Decisions & Rationale

**Decision 1: Reuse Zwift's OAuth & Sync Infrastructure**
- **Choice:** Implement Strava using same OAuth Manager, Normalizer, Sync Orchestrator modules as Zwift
- **Rationale:** DRY principle; reduces code duplication; ensures consistency across platforms; faster implementation
- **Constitution Alignment:** Code Quality & Testing (modular design), Cross-Platform Integration (standardized patterns)
- **Alternatives Considered:** Separate implementation per platform (duplicate code), shared base class (over-engineered)
- **Impact:** Requires generic OAuth interface; Strava-specific code isolated in adapter layer; ~50% faster than Zwift

**Decision 2: Strava API v3 (Current Production)**
- **Choice:** Target Strava API v3 (not v4 beta or deprecated v2)
- **Rationale:** v3 is stable, widely used, excellent documentation; v4 still in beta; v2 deprecated
- **Constitution Alignment:** Reliability & Uptime (stable API), Cross-Platform Integration (future-proof choice)
- **Alternatives Considered:** v4 beta (risk of breaking changes), v2 (deprecated)
- **Impact:** Lock-in to v3 until Strava sunsets (estimated 5+ years); migration path to v4 when stable

**Decision 3: Read-Only Scope (No Activity Creation)**
- **Choice:** Request only `read` scope from Strava OAuth (cannot create/edit activities)
- **Rationale:** MVP simplicity; no write conflicts; focus on ingestion; aligns with Apple Health read-only approach
- **Constitution Alignment:** Data Privacy & Security (principle of least privilege), User Experience & Simplicity (simpler flow)
- **Alternatives Considered:** Request write scope (adds complexity, potential data corruption risk)
- **Impact:** Users cannot delete/modify Strava activities from FitHub (can only view); future feature for v2+

**Decision 4: Activity Type Mapping Strategy (Strava-Specific)**
- **Choice:** Map Strava activity types (Run, Ride, Swim, Hike, Walk, etc.) to canonical format via mapping table
- **Rationale:** Strava has 30+ activity types; FitHub uses 6 canonical types; mapping reduces normalization complexity
- **Constitution Alignment:** Code Quality & Testing (testable mapping), Cross-Platform Integration (standardized types)
- **Alternatives Considered:** 1:1 tracking of all Strava types (bloats data model), hardcoded switch statement (not reusable)
- **Impact:** Easy to add new Strava types; mapping maintained in configuration

**Decision 5: Incremental Sync with Modified Detection**
- **Choice:** Detect modified activities (name, description, stats changes) via `updated_at` field
- **Rationale:** Strava includes `updated_at` in API; allows users to fix typos on Strava and have FitHub reflect changes
- **Constitution Alignment:** User Experience & Simplicity (always fresh data), Reliability & Uptime (eventual consistency)
- **Alternatives Considered:** Fetch only new activities (miss updates), re-fetch all activities (expensive, slow)
- **Impact:** More API calls for incremental sync, but still <5 sec for typical user

**Decision 6: Offline Activity Support (Strava Ecosystem)**
- **Choice:** Support both device-recorded and offline-imported activities from Strava
- **Rationale:** Strava allows manual activity upload; many users upload from Garmin, Apple Watch, etc.; should not exclude
- **Constitution Alignment:** User Experience & Simplicity (see all activities), Cross-Platform Integration (includes imported)
- **Alternatives Considered:** Filter out imported activities (loses data), separate handling (complex logic)
- **Impact:** No filtering needed; source app preserved in Strava data; transparent to user

---

## Architecture & Component Changes

**System Diagram:**

```
┌─────────────────────────────────────────────────────────────────┐
│                         iOS / Android App                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────┐                                            │
│  │  Strava Settings │                                            │
│  │  - Connect       │ (Reuses OAuth Manager from Zwift)         │
│  │  - Disconnect    │                                            │
│  └────────┬─────────┘                                            │
│           │                                                      │
│  ┌────────▼──────────────────────────────────────────┐          │
│  │     OAuth Manager (Shared)                        │          │
│  │  - Platform: "strava" parameter                   │          │
│  │  - PKCE + Token Management (same as Zwift)        │          │
│  └────────┬──────────────────────────────────────────┘          │
│           │                                                      │
│  ┌────────▼──────────────────────────────────────────┐          │
│  │     Strava Activity Fetcher (Adapter)             │          │
│  │  - Strava API v3 endpoints                        │          │
│  │  - Pagination (30 activities per page)            │          │
│  │  - Modified detection (updated_at field)          │          │
│  │  - Rate limit: 15 req/min                         │          │
│  └────────┬──────────────────────────────────────────┘          │
│           │                                                      │
│  ┌────────▼──────────────────────────────────────────┐          │
│  │     Normalizer (Shared)                           │          │
│  │  - Strava type mapping (Run → running)            │          │
│  │  - Unit conversion (meters → km)                  │          │
│  │  - Timezone extraction                            │          │
│  └────────┬──────────────────────────────────────────┘          │
│           │                                                      │
│  ┌────────▼──────────────────────────────────────────┐          │
│  │     Local Storage (Shared)                        │          │
│  │  - NormalizedActivity table                       │          │
│  │  - StravaConnection table (like ZwiftConnection)  │          │
│  │  - Retry queue                                    │          │
│  └───────────────────────────────────────────────────┘          │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
        │                                    │
        │ OAuth redirect                     │ HTTPS API calls
        │                                    │ (authenticated)
        ▼                                    ▼
    ┌────────────────────┐          ┌──────────────────────┐
    │  Strava OAuth      │          │  Strava API v3       │
    │  oauth.strava.com  │          │  api.strava.com      │
    │  - Authorization   │          │  - GET /athlete/     │
    │  - Token exchange  │          │    activities        │
    │  - PKCE flow       │          │  - Rate: 600 req/hr  │
    └────────────────────┘          │                      │
                                    │  Pagination: 30/page │
                                    └──────────────────────┘
```

**Shared Components (Reused from Zwift):**
- OAuth Manager (with platform parameter: "strava")
- Sync Orchestrator
- Normalizer (with Strava type mappings)
- Token Storage Adapter
- Background Task Scheduler

**New Components:**
- **Strava Activity Fetcher** (`src/integrations/strava/fetcher.ts`): Strava API v3-specific implementation
- **Strava Type Mapper** (`src/integrations/strava/type-mapper.ts`): Maps 30+ Strava types to 6 canonical types

**Modified Components:**
- **Activity Storage**: Add `strava_connections` table (mirrors `zwift_connections`)
- **Settings Screen**: Add "Connect Strava" button (mirrors Zwift button)

---

## Technical Details

### Data Model

**StravaConnection** (mirrors ZwiftConnection)
```sql
CREATE TABLE strava_connections (
  id TEXT PRIMARY KEY,
  strava_user_id TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL (encrypted),
  refresh_token TEXT NOT NULL (encrypted),
  token_expires_at INTEGER,
  connected_at INTEGER,
  last_sync_at INTEGER,
  is_active BOOLEAN DEFAULT 1
);
```

**Strava Activity Type Mapping**
```
Run → running
Ride → cycling
Swim → swimming
Hike → hiking
Walk → walking
[Everything else] → other

(30+ Strava types all map to these 6)
```

### API Contracts

**Strava OAuth Endpoints**
- Authorization: `https://www.strava.com/oauth/authorize?client_id={id}&response_type=code&redirect_uri={uri}&scope=read&state={state}&code_challenge={challenge}&code_challenge_method=S256`
- Token Exchange: `POST https://api.strava.com/v3/oauth/token`
- Revocation: `POST https://api.strava.com/v3/oauth/deauthorize`

**Strava API Endpoints**
- Activities: `GET https://api.strava.com/v3/athlete/activities?per_page=30&page={n}` (default: 30 per page, max 200)
- Activity Detail: `GET https://api.strava.com/v3/activities/{id}?include_all_efforts=false`

**Rate Limiting**
- Strava: 600 requests/hour (vs Zwift's 600/15min; less aggressive)
- Header: `X-RateLimit-Limit: 600`, `X-RateLimit-Usage: 50`

### Pseudo-Code Workflow

**Modified Activity Detection:**
```
1. Get all activities since last_sync_at
2. For each activity:
   a. Check if source_id exists in DB
   b. If exists && updated_at > db_updated_at:
      → Update activity (user edited on Strava)
   c. If exists && updated_at < db_updated_at:
      → Keep DB version (user edited in FitHub, not overwriting)
   d. If not exists:
      → Insert new activity
3. Update last_sync_at timestamp
```

---

## Constitution Check

**Principle 1: Data Privacy & Security** ✅
- Tokens encrypted, PKCE, no credentials logged, user disconnection revokes

**Principle 2: Cross-Platform Integration** ✅
- Handles Strava rate limits, reusable normalizer, conflict detection ready

**Principle 3: User Experience & Simplicity** ✅
- Connection <2 min, clear confirmation, descriptive errors, manual retry

**Principle 4: Reliability & Uptime** ✅
- Offline-first, retry logic, graceful degradation, 99.5% target

**Principle 5: Performance & Real-Time Sync** ✅
- Incremental sync <5 sec, background processing, batch normalization

**Principle 6: Code Quality & Testing** ✅
- Reuses Zwift components (tested), Strava-specific code isolated, mockable

**Principle 7: Transparency & Communication** ✅
- Sync status visible, source indicated, retry behavior transparent

---

## Phased Rollout

**Phase 1 (MVP):** OAuth + 3-month fetch (reuses Zwift infrastructure)
**Phase 2:** Incremental sync + modified activity detection
**Phase 3:** Multi-platform deduplication (Zwift + Strava + Apple Health)

---

## Next Steps

1. ✅ Plan complete for Strava
2. Create Apple Health plan (parallel)
3. Generate task breakdowns (speckit-tasks)
4. Begin implementation

---

**END OF STRAVA PLAN**
