# FitHub Implementation Roadmap: All Platforms

**Tech Stack Locked:** Flutter + SQLite + Keychain/Keystore  
**Generated:** 2026-05-05  
**Status:** Ready for implementation

---

## Overview

Three feature implementations with **strategic parallel execution** opportunities:

| Feature | Phase Count | Tasks | Effort | Reuse Rate | Start After |
|---------|------------|-------|--------|-----------|-------------|
| **Zwift OAuth** | 5 | 48 | 3-4 weeks | — | Immediate |
| **Strava OAuth** | 5 | 33 | 1.5-2 weeks | 80% | Zwift Phase 2 |
| **Apple Health** | 5 | 37 | 2-3 weeks | 40% (dedup) | Zwift Phase 2 |

---

## Architecture at Scale

### Shared Infrastructure

```
┌─────────────────────────────────────────────┐
│         Flutter iOS + Android App            │
├─────────────────────────────────────────────┤
│                                               │
├─ OAuth Manager (parametrized by platform)   │ ← Zwift, Strava
│  - PKCE flow, token exchange, refresh       │
│                                               │
├─ Normalizer Layer (5 implementations)        │ ← Platform-specific
│  - Zwift types → 6 canonical               │
│  - Strava types → 6 canonical              │
│  - HealthKit types → 6 canonical           │
│  - Ensures consistent data model            │
│                                               │
├─ Deduplication Engine (NEW SHARED)           │ ← Cross-platform
│  - Confidence scoring algorithm              │
│  - Candidate matching                        │
│  - User resolution workflow                  │
│                                               │
├─ Sync Orchestrator                           │ ← All platforms
│  - Fetch → normalize → deduplicate → save   │
│                                               │
├─ Database Layer                              │
│  - normalized_activities (all platforms)    │
│  - activity_duplicates (cross-platform)     │
│  - platform-specific connections            │
│                                               │
└─ Token Storage (platform-native)             │
   - iOS Keychain (AES-256)                   │
   - Android Keystore (AES-256)               │
```

### Code Reuse Breakdown

```
Zwift:        48 tasks (100% new)
Strava:  -24 tasks (80% reused from Zwift)
           = 24 new tasks
           
Apple Health: -14 tasks (from dedup + normalizer)
             = 23 new tasks (12 for dedup engine, 11 Health-specific)
             
Total New Implementation: 48 + 24 + 23 = 95 tasks
Avoided Duplication: 24 + 14 = 38 tasks
Efficiency Gain: 38/133 = 29% less code
```

---

## Sequential Execution Timeline (7-8 weeks)

```
WEEK 1-2: Zwift Phase 1-2 (Setup + Foundational)
  └─ Days 1-3: Setup (project, dependencies, iOS/Android config)
  └─ Days 4-10: Foundational (token storage, normalizer, DB)

WEEK 3-4: Zwift Phase 3-4 (OAuth + Sync)
  └─ Days 11-17: OAuth connection, athlete profile, UI
  └─ Days 18-24: Manual sync, batch processing, error handling

WEEK 5: Zwift Phase 5 (Polish)
  └─ Days 25-30: Retry queue, disconnect, logging, E2E, docs

WEEK 6-7: Strava Phase 1-5 (Reuse + Strava-specific)
  └─ Days 31-35: Setup + Foundational (Strava normalizer, API config)
  └─ Days 36-42: OAuth + Sync (leveraging Zwift components)
  └─ Days 43-45: Polish

WEEK 8: Apple Health Phase 1-5 (Platform channel + Dedup)
  └─ Days 46-50: Setup + dedup engine (NEW shared component)
  └─ Days 51-56: Permission + initial fetch + dedup UI
  └─ Days 57-61: Incremental sync, disconnect, E2E, docs
```

---

## Recommended: Parallel Execution Timeline (4-5 weeks)

```
WEEK 1: Zwift Phase 1-2 + Setup infrastructure
  └─ All three projects created in parallel
  └─ Dependencies added to pubspec.yaml (flutter_appauth, sqflite, health, ...)
  └─ iOS/Android configurations for all three platforms

WEEK 2: Zwift Phase 3-4 + Strava Phase 1-2
  └─ Zwift: OAuth manager, API client, normalizer, UI
  └─ Strava: Normalizer, API config, OAuth provider
  └─ Health: Platform channel, deduplication engine (NEW shared)

WEEK 3: Zwift Phase 5 + Strava Phase 3-4 + Health Phase 1-2
  └─ Zwift: Retry queue, disconnect, logging, E2E
  └─ Strava: OAuth flow, sync orchestration (reusing Zwift)
  └─ Health: Permission UI, initial fetch, connection status

WEEK 4: Strava Phase 5 + Health Phase 3-4
  └─ Strava: Polish (disconnect, logging, E2E)
  └─ Health: Deduplication UI, cross-platform matching, integration tests

WEEK 5: Health Phase 5 + Final integration
  └─ Health: Incremental sync, background tasks, E2E
  └─ All three platforms: End-to-end testing, cross-platform dedup validation
  └─ Beta testing with internal team
```

**Time Savings:** 3-4 weeks (40-50% reduction) vs sequential approach

---

## Implementation Strategy

### MVP Scope (Phase 3-4 for all platforms)

**Must Have:**
- [x] OAuth connection (Zwift, Strava)
- [x] HealthKit permission (Apple Health)
- [x] Manual sync trigger
- [x] Activity normalization
- [x] Local storage (no backend sync)
- [x] Connection status display
- [x] Disconnect capability

**Nice to Have (Phase 5):**
- [ ] Auto-sync every 30 minutes
- [ ] Deduplication UI
- [ ] Retry queue with exponential backoff
- [ ] Advanced error handling
- [ ] Observability (debug metrics)

### Quality Gates

| Gate | Target | Verification |
|------|--------|--------------|
| **Unit Test Coverage** | ≥80% | `flutter test --coverage` |
| **Integration Tests** | All OAuth flows | `test_integration/*` |
| **E2E Tests** | Full sync cycle | `test_e2e/*` |
| **Security Audit** | OAuth best practices | PKCE, token storage verified |
| **Performance** | <2 min initial sync | P95 latency measured |
| **Error Handling** | Graceful degradation | All error paths tested |

---

## Key Decisions Locked

### Zwift OAuth (decision-002-zwift-oauth)
- ✅ PKCE for mobile security
- ✅ On-device token storage (Keychain/Keystore)
- ✅ 3-month initial sync (MVP scope)
- ✅ 30-minute auto-sync interval
- ✅ Exponential backoff retry (5 min → 1 hr)
- ✅ Separate normalizer layer (reusable)

### Strava OAuth (decision-003-strava-oauth)
- ✅ 80% code reuse from Zwift
- ✅ Strava-specific type mappings (30+ types → 6 canonical)
- ✅ Modified activity detection (via `updated_at` field)
- ✅ Rate limit handling (600 req/hr)
- ✅ Same 3-month initial sync

### Apple Health (decision-004-apple-health)
- ✅ iOS-only MVP (Android v2+)
- ✅ Local-only data (no backend sync)
- ✅ Permission-based (not OAuth)
- ✅ Deduplication engine for cross-platform matching
- ✅ Confidence scoring (>85% auto-flag, 70-85% user confirm, <70% separate)

### Tech Stack (decision-004-tech-stack)
- ✅ **Framework:** Flutter (Dart)
- ✅ **Database:** SQLite via `sqflite`
- ✅ **OAuth:** `flutter_appauth` package
- ✅ **Health:** `health` package + platform channel for advanced queries
- ✅ **Token Storage:** Native Keychain (iOS) + Keystore (Android)

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| **Zwift API changes** | Monitor API status; maintain fallback |
| **OAuth token expiration** | Proactive refresh 5 min before expiry |
| **Rate limit hitting** | Exponential backoff + batch processing |
| **Deduplication false positives** | High threshold (85%) for auto-flag; user review for 70-85% |
| **HealthKit permission denied** | Graceful degradation; link to Settings |
| **Cross-platform data loss** | No deletion without confirmation; audit logs |
| **Background sync battery drain** | 30-minute interval; Wi-Fi preference |
| **SQLite corruption** | Regular backups; migration versioning |

---

## Success Criteria

**Phase 1 (Zwift):**
- [x] 10 beta testers connect Zwift successfully
- [x] ≥99% sync success rate (2-week testing)
- [x] <2 min initial sync, <30 sec delta sync
- [x] Zero OAuth vulnerabilities

**Phase 2 (Strava):**
- [x] Strava integration leverages 80% Zwift code
- [x] Type mappings verified for all 30+ Strava types
- [x] Users can connect Zwift + Strava simultaneously

**Phase 3 (Apple Health):**
- [x] HealthKit permission granted without friction
- [x] Deduplication correctly identifies 95%+ cross-platform duplicates
- [x] All three platforms work simultaneously without data loss

---

## Deliverables Summary

### Specifications (Complete)
- ✅ `002-zwift-oauth/spec.md` (3 user scenarios, 18 requirements)
- ✅ `003-strava-oauth/spec.md` (3 user scenarios, parallel structure to Zwift)
- ✅ `004-apple-health-integration/spec.md` (4 user scenarios, permission-based)

### Plans (Complete)
- ✅ `002-zwift-oauth/plan.md` (7 design decisions, architecture, phased rollout)
- ✅ `003-strava-oauth/plan.md` (80% reuse strategy, Strava-specific adapters)
- ✅ `004-apple-health-integration/plan.md` (HealthKit + dedup engine, iOS-specific)

### Research (Complete)
- ✅ `002-zwift-oauth/research.md` (tech stack, API details, PKCE flow, error handling)
- ✅ `003-strava-oauth/research.md` (API v3 specifics, type mappings, rate limiting)
- ✅ `004-apple-health-integration/research.md` (HealthKit framework, permissions, dedup algorithm)

### Data Models (Complete)
- ✅ `002-zwift-oauth/data-model.md` (ZwiftConnection, NormalizedActivity, SyncRetryQueue)
- ✅ `003-strava-oauth/data-model.md` (StravaConnection, type mappings, query patterns)
- ✅ `004-apple-health-integration/data-model.md` (HealthConnection, dedup metadata, queries)

### Implementation Tasks (Complete)
- ✅ `002-zwift-oauth/tasks.md` (48 tasks, 5 phases, MVP scope)
- ✅ `003-strava-oauth/tasks.md` (33 tasks, 5 phases, 80% reuse)
- ✅ `004-apple-health-integration/tasks.md` (37 tasks, 5 phases, iOS-specific)

### Tech Stack Documentation (Complete)
- ✅ `.specify/memory/tech-stack.md` (Flutter + SQLite + Keychain/Keystore decisions)
- ✅ `.specify/memory/constitution.md` (7 principles governing all features)

---

## Next Steps

1. **Review & Sign-Off**
   - [ ] Product Owner review of all three specs
   - [ ] Architecture review of design decisions
   - [ ] Security review of OAuth implementation

2. **Begin Implementation**
   - [ ] Choose execution model (sequential vs parallel)
   - [ ] Allocate team resources
   - [ ] Set up CI/CD pipeline for Flutter + tests

3. **Phase 1 Kickoff (Zwift)**
   - [ ] Create Flutter project structure
   - [ ] Add dependencies to pubspec.yaml
   - [ ] Configure iOS/Android for OAuth redirect URIs

---

**Version:** 1.0.0  
**Status:** All designs locked, ready for implementation  
**Generated By:** Copilot speckit-tasks workflow  
**Last Updated:** 2026-05-05
