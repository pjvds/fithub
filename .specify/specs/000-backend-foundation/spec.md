# Feature Specification: Backend Foundation

> **Pivot note (2026-05-06):** This spec was authored when mobile (Flutter) was the planned v1 client. Per the 2026-05-06 pivot, the v1 user-facing client is the **web app** (`005-web-frontend`); native mobile is **postponed**. References below to "mobile" / "Push Service" / "Apple Health upload endpoint" remain valid as forward-looking architecture (the events and endpoints are designed for that future client) but **the Push Notification Worker and `/api/health/upload` are not built or exposed in v1**. See `.specify/memory/architecture-overview.md` (AD-1, AD-3) for the canonical pivot record.

---

## Feature Overview

**Feature Name:** Backend Foundation (API Gateway, OAuth Vault, Sync Orchestrator, Deduplication Engine, Push Service)

**Feature ID:** feat-000-backend-foundation

**Version:** 1.0.0

**Status:** Draft

**Date:** 2026-05-05

---

## Clarifications

### Session 2026-05-06

- **Q:** How should information changes flow through the system, and how should large payloads (e.g., FIT files) be carried by events?
  **A:** All domain state changes flow as events using the **D1 transactional outbox pattern → Cloudflare Queues**. Events carry small JSON payloads only; large binary artifacts (FIT/TCX files, raw platform API payloads) are stored in **Cloudflare R2** and referenced from events by **storage path only** (e.g., `users/<user_id>/activities/<activity_id>/raw.fit`) — never as a fully-qualified R2 URL, bucket reference, or provider-specific URI. This keeps events portable across storage backends and lets the storage adapter resolve the path. Rationale: outbox is Cloudflare's officially documented best practice for guaranteed DB↔bus consistency on D1; path-only refs preserve a clean abstraction boundary.

- **Q:** What event schema standard should events use on the wire?
  **A:** All events MUST conform to the **CloudEvents v1.0 JSON specification** (CNCF standard). Every event carries the required CloudEvents attributes (`specversion`, `id`, `source`, `type`, `time`) plus domain-specific `data`. Zod schemas validate the `data` payload per event type at both publish and consume boundaries. Rationale: CloudEvents is the vendor-neutral wire standard; adopting it from day one avoids a future migration, enables webhook-out without envelope rewriting, and tooling/observability ecosystems already understand the format.

- **Q:** How should consumers handle duplicate event delivery?
  **A:** **At-least-once delivery + consumer-side idempotency keys with bounded-window cleanup.** The CloudEvents `id` (UUID, assigned at outbox insert time) serves as the idempotency key. Each consumer tracks processed event IDs in a `processed_events` D1 table. A daily cron sweep deletes rows older than 24 hours. This is safe because Cloudflare Queues' maximum retry window is 12 hours — so a successfully-processed event can never be re-delivered after its `processed_events` row has been cleaned up (24h cleanup > 12h retry window). During extended consumer outages (>12h), undelivered messages move to the dead-letter queue (DLQ) rather than being lost; DLQ replay introduces them as fresh deliveries with the original `event_id`, so dedup still works correctly if the row happens to exist, and processes normally if it doesn't. Per-user ordering is already serialized by the Durable Object (AD-5), so no global ordering guarantees are needed.

- **Q:** What happens to `outbox_events` rows after the Outbox Relay Worker publishes them to Queues?
  **A:** Rows are marked with a `processed_at` timestamp after successful enqueue but **not deleted**. This provides a built-in audit trail and enables re-emission of recent events without reconstructing from domain state. An automated sweep (e.g., delete rows where `processed_at > 7 days`) is deferred to a later phase — for MVP the table accumulates. At expected scale (~thousands of events/day) D1 storage impact is negligible.

- **Q:** Which state changes should emit domain events?
  **A:** **Domain events only** — emit events for business-significant state changes where another service or the user needs to react. Internal mechanics (token refresh success, retry scheduling, cache warm) stay within the owning Worker. Guiding principle: *if only the owning Worker cares, don't emit*. It's easier to promote an internal event to a domain event later than to remove one consumers depend on.

---

## Problem Statement

**What problem does this feature solve?**

FitHub's hybrid architecture (per `.specify/memory/architecture-overview.md`) requires a backend service that:
1. Holds OAuth tokens for cloud platforms (Zwift, Strava) so tokens are not exposed on user devices and can be refreshed centrally.
2. Polls cloud platforms (Zwift) and consumes webhooks (Strava) to fetch workout data without each device hammering external APIs.
3. Stores a canonical, deduplicated activity record per user, accessible across all their devices.
4. Pushes notifications to mobile clients when new data is available.

Without this foundation, none of the three platform integrations (Zwift, Strava, Apple Health) can be implemented as currently designed.

**Why now?**

This is a prerequisite for `001-user-authentication` and all three platform-integration features (`002-zwift-oauth`, `003-strava-oauth`, `004-apple-health-integration`). It must exist before any of them can begin Phase 1 implementation.

---

## Proposed Solution

**What is the feature?**

A backend service exposing a REST API to authenticated clients (web in v1; mobile in a future release), containing five core subsystems:

1. **API Gateway** — Authenticated REST endpoints for clients (web in v1; mobile in v2+).
2. **OAuth Token Vault** — Encrypted storage and lifecycle management of platform tokens.
3. **Sync Orchestrator** — Schedules platform polls, handles webhooks, manages retries.
4. **Deduplication Engine** — Matches activities across sources, merges into canonical records.
5. **Push Notification Service** — Notifies mobile clients of new data via APNs/FCM.

The backend is the source of truth for cloud-platform activity data and the destination for device-local data (Apple Health) pushed from mobile.

**User Stories**

```
As the FitHub web app,
I want to register a connection to a cloud platform on the user's behalf,
so that the backend can fetch the user's data without storing tokens client-side.
```

```
[DEFERRED — mobile v2+]
As the FitHub mobile app,
I want to receive a push notification when new activities are available,
so that I can fetch and display them with minimal latency and battery impact.
```

```
[DEFERRED — mobile v2+]
As the FitHub mobile app,
I want to upload Apple Health activities to the backend,
so that they are deduplicated against cloud-platform data and available on the user's other devices.
```

```
As a user with multiple devices,
I want my activities to appear consistently across devices and the web,
so that I have a single, unified workout history regardless of how I access FitHub.
```

**Acceptance Criteria**

- [ ] AC-1: A web client can complete an OAuth flow for a cloud platform; tokens are stored server-side, never returned to the client.
- [ ] AC-2: Backend polls Zwift every 30 minutes (±1 min) for each connected user and stores new activities.
- [ ] AC-3: Backend processes Strava webhook events within 30 seconds of receipt and fetches activity details.
- [ ] AC-4: *(DEFERRED — mobile v2+)* Mobile client can upload an Apple Health activity payload; backend persists raw payload and canonical fields.
- [ ] AC-5: Deduplication Engine merges activities matching at >85% confidence into one canonical record with multiple source references.
- [ ] AC-6: *(DEFERRED — mobile v2+)* When new data is available for a user, backend sends a silent push within 60 seconds of ingestion.
- [ ] AC-7: Mobile client can fetch activities since a cursor and receives only new/updated records.
- [ ] AC-8: Failed external API calls retry with exponential backoff (5m, 15m, 30m, 1h, capped at 24h total window).
- [ ] AC-9: An OAuth token marked as invalid (401/403 from platform) is flagged for user re-authentication; backend stops polling until reconnect.
- [ ] AC-10: A user can disconnect a platform; backend revokes the token with the platform, deletes the token vault entry, and (per user choice) deletes or retains historical activities.

---

## Constitution Alignment Checklist

### ✅ Data Privacy & Security
- [x] User data encrypted at rest (AES-256 minimum) — Tokens encrypted in vault; activity DB encrypted at storage layer
- [x] Data transmission uses TLS 1.3+ — Enforced on all backend endpoints and external platform calls
- [x] User consent is explicit and revocable — OAuth flow + disconnect endpoint
- [x] Third-party integrations vetted for security — Zwift, Strava OAuth flows follow RFC 6749 + 7636 (PKCE)
- **Notes:** OAuth tokens never leave backend boundary. Web client receives only session cookies (FitHub's own auth).

### ✅ Cross-Platform Integration
- [x] Adapter/integration follows platform-specific API requirements — Per-platform adapter modules
- [x] Rate limits and retry logic implemented — Centralized in Sync Orchestrator
- [x] Conflict detection logic defined — Deduplication Engine with confidence scoring
- [x] Platform-specific data normalization documented — Lossless model preserves raw payloads
- **Notes:** Centralized rate-limit handling is a key benefit of backend-driven architecture.

### ✅ User Experience & Simplicity
- [x] Onboarding/setup completable in <5 minutes — OAuth flow proxied through backend, redirects to web app
- [x] Error messages are clear and actionable — API returns user-safe error codes; web client maps to friendly text
- [x] Advanced options hidden by default — N/A (no UI in this feature)
- [x] Fewer than 3 taps/clicks for core action — Mobile UI handles UX; backend supports it
- **Notes:** This feature has no direct UI but must support fast, low-friction client flows.

### ✅ Reliability & Uptime
- [x] Offline scenarios handled — Mobile cache; backend Cloudflare Queues persist across Worker evictions
- [x] Failed operations retry with exponential backoff — Specified in AC-8
- [x] Data persistence survives app restart/reboot — Backend uses durable D1 (Cloudflare SQLite) + Cloudflare Queues (durable, survives Worker eviction)
- [x] Monitoring/alerting requirements defined — See Non-Functional Requirements
- **Notes:** Backend SLO target: 99.5% uptime. Cloudflare Queues are durable — in-flight sync work survives Worker eviction.

### ✅ Performance & Real-Time Sync
- [x] Latency targets defined — <5 min P95 from platform event to mobile notification
- [x] Caching strategy documented — D1 for persistence + Workers KV for hot user activity feeds
- [x] Batching/optimization approach defined — Webhook batching, paginated fetches
- [x] Performance regression testing planned — Load tests in CI for sync orchestrator throughput
- **Notes:** Strava webhook path achieves <60s latency; Zwift poll path bounded by 30-min interval.

### ✅ Code Quality & Testing
- [x] Unit test coverage target ≥80%
- [x] Integration test scenarios identified — OAuth flow, webhook handling, dedup engine
- [x] E2E test plan defined — Mock platform → backend → web client fixture
- [x] Code review process enforced in PR
- [x] Static analysis (linting, type-checking) requirements listed — Per chosen language stack
- **Notes:** Dedup engine requires extensive unit tests across confidence-score boundaries.

### ✅ Transparency & Communication
- [x] User-facing documentation/help text planned — Connection management, disconnect behavior
- [x] Privacy/data handling implications documented — Tokens server-side; user can revoke; data retention policy
- [x] Known limitations or caveats identified — See Open Questions
- [x] Release notes content drafted — Will accompany feature release
- **Notes:** Privacy disclosure must explain that tokens are stored server-side.

### ✅ Functional & Structured Logging
- [x] All services emit JSON-structured logs — Implemented in `packages/core/src/logging/logger.ts`; Hono middleware in `packages/functions/src/api/middleware/logger.ts`
- [x] Required fields present: `ts`, `level`, `event`, `service`, `env` — Enforced by core logger
- [x] Correlation ID propagated across services — Hono correlation middleware adds `correlationId` to all request-scoped loggers
- [x] `userId` included where applicable — Logger child contexts accept `userId` field
- [x] Error logs include typed error code — `ErrorCode` enum enforced in logger for `error`-level entries
- [x] Sensitive data not logged — Deny-list in `packages/core/src/logging/logger.ts`; token vault inputs/outputs explicitly excluded
- [ ] Log aggregator configured for Logpush — T053 pending (destination TBD; candidates: Better Stack / Axiom)
- **Notes:** Core logger module shipped in Phase 1 (commit `6bfd381`). Logpush destination needs deciding before Phase 7.

---

## Technical Specification

### Scope

**In Scope:**

1. **API Gateway**
   - Authenticated REST endpoints (client-to-backend)
   - User session/auth management (FitHub identity, distinct from platform OAuth)
   - Rate limiting on incoming client requests
   - Common error response format

2. **OAuth Token Vault**
   - Encrypted at-rest storage of access + refresh tokens (AES-256-GCM, master key in Workers Secrets)
   - Platform OAuth flow handlers (initiate, callback, exchange) for Zwift and Strava
   - Automatic token refresh before expiry
   - Token revocation on user disconnect
   - Audit log of token operations (issued, refreshed, revoked, failed)

3. **Sync Orchestrator**
   - Per-user, per-platform poll scheduler (cron-like, 30-min cadence for Zwift)
   - Webhook ingestion endpoint for Strava
   - Per-platform adapter interface (`fetch_activities`, `get_profile`, `validate_token`, `revoke_token`)
   - Durable retry queue (survives Worker eviction) with exponential backoff
   - Rate-limit budgeting per platform

4. **Deduplication Engine**
   - Confidence-scoring algorithm (per AD-4 in architecture overview): type (30) + start_time ±5m (30) + duration ±10% (25) + distance ±5% (15)
   - Match scope: same user, ±15-min time window
   - Auto-merge at >85%, user-confirm at 70-85%, separate at <70%
   - Per-field fidelity ranking when merging (e.g., Strava distance > Zwift distance)
   - Idempotent: re-running on same data yields same result

5. **Canonical Activity Store**
   - D1 tables: `users`, `connections`, `activities`, `activity_sources`, `dedup_pending`, `audit_log`, `push_devices`, `outbox_events`, `processed_events`
   - Raw platform payloads stored in R2 blob storage at deterministic paths; `activity_sources` stores reference metadata
   - Schema versioning to support re-normalization

6. **Push Notification Service** *(DEFERRED — mobile v2+)*
   - APNs (iOS) and FCM (Android) integration
   - Silent pushes (data-only) to wake mobile sync client
   - Per-device token registration/refresh from mobile
   - Push failure handling (invalid token → mark device inactive)

7. **Apple Health Ingestion Endpoint** *(DEFERRED — mobile v2+)*
   - `POST /api/health/upload` accepts batched activity payloads from mobile
   - Validates payload, persists raw + canonical, runs dedup, emits push to other user devices

**Out of Scope:**

- Mobile app implementation (native mobile is postponed; planned for v2+)
- Platform-specific OAuth UI flows on mobile (v2+)
- Apple Health observer/extraction logic on iOS (v2+ — mobile only)
- User account creation / login UI (assumed handled by separate `001-user-authentication` feature; this spec assumes authenticated user identity is available)
- Health Connect (Android) — v2+
- Analytics, dashboards, export — v2+
- Activity editing by users — v2+

### Technical Constraints

- **Platform Compatibility:** Backend service (cloud-hosted). v1 serves the Astro web client (`005-web-frontend`). Future mobile clients (iOS/Android) will be added in v2+.
- **API/Service Dependencies:** Zwift API, Strava API + webhooks, APNs, FCM, Workers Secrets for encryption master key, D1 (Cloudflare SQLite) for persistence, R2 for blob storage.
- **Data Format/Schema Changes:** Schema versioning required; raw payloads enable re-normalization without re-fetch.
- **Performance Requirements:**
  - API gateway: P95 <500ms for web client read endpoints.
  - Sync orchestrator: complete a per-user poll within 60s for typical user (50 activities to fetch).
  - Push delivery: <60s from ingestion to client notification (mobile push deferred to v2+).
  - End-to-end latency (platform event → web UI refresh): <5 min P95.
- **Security/Compliance:**
  - Tokens encrypted at rest with app-layer AES-256-GCM; master key in Workers Secrets.
  - All transport TLS 1.3+.
  - GDPR: user can request export and deletion of their data.
  - Audit log of all token operations and data access retained ≥1 year.
  - No PII in application logs.

### Functional Requirements

- **FR-1:** System MUST persist OAuth access and refresh tokens encrypted at rest per NFR-1 (AES-256-GCM with versioned ciphertext).
- **FR-2:** System MUST refresh access tokens before expiry without user intervention; failed refresh MUST flag connection as `requires_reauth`.
- **FR-3:** System MUST poll each connected Zwift user every 30 minutes (±1 minute jitter) for new activities.
- **FR-4:** System MUST register and process Strava webhook subscriptions per user; webhook payloads MUST trigger activity fetch within 30 seconds.
- **FR-5:** *(DEFERRED — mobile v2+)* System MUST accept mobile uploads of Apple Health activity payloads via authenticated REST endpoint.
- **FR-6:** System MUST run the deduplication algorithm on every newly ingested activity, regardless of source.
- **FR-7:** System MUST merge activities scoring >85% confidence into a single canonical record with multiple `activity_sources` entries.
- **FR-8:** System MUST flag activities scoring 70–85% for user confirmation and expose them via a `GET /api/dedup/pending` endpoint.
- **FR-9:** *(DEFERRED — mobile v2+)* System MUST send a silent push notification to all of a user's registered devices within 60 seconds of ingesting new activities.
- **FR-10:** System MUST expose `GET /api/activities?since=<cursor>` returning new/updated activities since the cursor, paginated.
- **FR-11:** System MUST expose `POST /api/connections/:platform/disconnect` that revokes the token with the platform, deletes the vault entry, and (per user-supplied flag) deletes or retains historical activities.
- **FR-12:** System MUST persist sync work durably via Cloudflare Queues and Durable Objects; in-flight sync jobs survive Worker eviction and are retried automatically. (See also NFR-9.)
- **FR-13:** System MUST distinguish transient (timeout, 429, 5xx) from permanent (401, 403, 404) errors; only transient errors enter retry queue.
- **FR-14:** System MUST respect platform rate limits centrally (single token's budget shared across all calls for that user).
- **FR-15:** System MUST log every token operation (issue, refresh, revoke, fail) and every external API call (without payload, only metadata) for ≥1 year.

### Non-Functional Requirements

- **NFR-1 (Security):** All tokens AES-256-GCM encrypted at rest (app-layer); master key stored in Workers Secrets with versioned ciphertext format (`v1:iv:ciphertext:tag`) supporting key rotation.
- **NFR-2 (Availability):** 99.5% uptime SLO measured monthly; planned maintenance excluded.
- **NFR-3 (Latency):** Client-facing read endpoints P95 <500ms; client-facing write endpoints P95 <1s.
- **NFR-4 (Throughput):** Support 10,000 concurrent users with 30-min poll cadence (≈5.5 polls/sec aggregate baseline).
- **NFR-5 (Scalability):** Horizontal scale of stateless API gateway; sync orchestrator partitionable by user_id.
- **NFR-6 (Observability):** All Workers MUST emit JSON-structured operational logs with required fields (`ts`, `level`, `event`, `service`, `env`, `correlationId`, `userId` when known). Functional event names MUST come from a documented vocabulary (e.g. `auth.token.rejected`, `oauth.refresh.failed`, `sync.job.completed`); `error`-level entries MUST carry a typed `code`. Correlation IDs MUST flow from the API request through queue messages and CloudEvents envelopes so a single user-visible operation can be traced end-to-end. Logs MUST be shipped to a log aggregator with 30-day hot retention and aggregate metrics for poll success/fail rates, push delivery rates, dedup match rates; alerts on SLO violations. (Constitution Principle 8.)
- **NFR-7 (Privacy):** No application logs contain PII (emails, names, tokens, raw activity payloads). The structured logger enforces this via a deny-list applied at emit time.
- **NFR-8 (Data Durability):** D1 data replicated by Cloudflare with automatic global read replicas; durability and availability governed by Cloudflare SLA. R2 blob storage provides 99.999999999% (11 9's) durability.
- **NFR-9 (Resilience):** Serverless architecture (Cloudflare Workers) has no traditional restarts; in-flight sync work is persisted via Cloudflare Queues (durable) and Durable Objects (persistent state). See FR-12.

### Architecture & Components

See `.specify/memory/architecture-overview.md` for the full system diagram. The backend foundation is the central tier; this spec defines its internal structure:

```
┌─────────────────────────── Backend Foundation ─────────────────────────────┐
│                                                                             │
│  ┌──────────────┐   ┌──────────────────┐   ┌──────────────────────────┐    │
│  │ API Gateway  │◄─►│ Auth Middleware  │   │ Push Notification Worker │    │
│  │   (REST)     │   │ (FitHub session) │   │ (APNs/FCM)               │    │
│  └──────┬───────┘   └──────────────────┘   └──────────▲───────────────┘    │
│         │                                              │                    │
│  ┌──────▼─────────────────────────────────────────────┴───────────────┐    │
│  │              Application Services Layer (Workers)                  │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐          │    │
│  │  │ OAuth Vault  │  │ Sync         │  │ Deduplication    │          │    │
│  │  │ Service      │  │ Orchestrator │  │ Engine           │          │    │
│  │  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘          │    │
│  │         │                 │                    │                    │    │
│  │  ┌──────▼─────────────────▼────────────────────▼──────────┐        │    │
│  │  │           Platform Adapter Interface                    │        │    │
│  │  │   ┌──────────┐  ┌──────────┐  ┌──────────────────┐    │        │    │
│  │  │   │ Zwift    │  │ Strava   │  │ Apple Health     │    │        │    │
│  │  │   │ Adapter  │  │ Adapter  │  │ Ingest Adapter   │    │        │    │
│  │  │   └──────────┘  └──────────┘  └──────────────────┘    │        │    │
│  │  └─────────────────────────────────────────────────────────┘       │    │
│  └─────────────────────┬──────────────────────────────────────────────┘    │
│                        │ writes state + outbox row in one D1 batch         │
│  ┌─────────────────────▼──────────────────────────────────────────────┐    │
│  │  D1 (SQLite-on-Cloudflare) — source of truth                       │    │
│  │  Tables: users, connections, activities, activity_sources,          │    │
│  │          dedup_pending, audit_log, push_devices,                    │    │
│  │          outbox_events, processed_events                            │    │
│  └─────────────────────┬──────────────────────────────────────────────┘    │
│                        │ drained by Outbox Relay Worker (Cron)              │
│  ┌─────────────────────▼──────────────────────────────────────────────┐    │
│  │  Cloudflare Queues — domain event bus                              │    │
│  │  (small JSON events, blob refs by path only)                       │    │
│  └─────┬──────────┬──────────────┬─────────────────────────────────────┘    │
│        │          │              │                                          │
│   ┌────▼───┐ ┌────▼─────┐ ┌──────▼────────┐                                 │
│   │ Dedup  │ │ Push     │ │ Future        │                                 │
│   │ Worker │ │ Notifier │ │ subscribers   │                                 │
│   └────────┘ └──────────┘ └───────────────┘                                 │
│                                                                             │
│  ┌─────────────────────── Blob Storage ─────────────────────────────┐       │
│  │  R2: FIT/TCX files, raw platform API payloads                    │       │
│  │  Path convention: users/<user_id>/activities/<activity_id>/...   │       │
│  │  Events reference blobs by path only (storage-agnostic)          │       │
│  └──────────────────────────────────────────────────────────────────┘       │
│                                                                             │
│  ┌──────────────────── Per-Entity Coordination ─────────────────────┐       │
│  │  Durable Objects (one per user, lazy-instantiated)               │       │
│  │  Used for: dedup serialization, sync-job mutex, mobile WS push   │       │
│  └──────────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key Components:**

- **API Gateway (Worker):** Stateless HTTP layer; auth middleware validates FitHub session; routes to services.
- **OAuth Vault Service:** Token CRUD, AES-256-GCM encryption (app-layer), refresh scheduler, audit logging.
- **Sync Orchestrator:** Cron-driven scheduler, webhook handler, retry queue with exponential backoff, per-platform rate-limit budget.
- **Platform Adapters:** Interface (`fetch_activities`, `get_profile`, `validate_token`, `revoke_token`); concrete impls per platform; raw payloads written to R2.
- **Deduplication Engine:** Consumes activity-ingested events; computes match scores; emits merge/split events. Coordinated per-user via a Durable Object to serialize concurrent ingest decisions.
- **Push Notification Worker:** Subscribes to relevant events (e.g., `activity.created`, `connection.changed`); sends silent APNs/FCM pushes.
- **Outbox Relay Worker:** Cron-triggered; drains `outbox_events` rows from D1 in batches and publishes to Cloudflare Queues; marks rows processed only after successful publish.
- **Domain Event Bus (Cloudflare Queues):** All inter-service communication after the initial DB write happens here. Events conform to the **CloudEvents v1.0 JSON** specification, are small (≤4 KB JSON), and reference R2 blobs by path only. Zod schemas validate the `data` payload per event type at publish and consume boundaries.
- **Blob Store (R2):** Holds large binary artifacts (FIT/TCX files, raw platform API payloads) at deterministic paths. Events do not include R2 URLs, bucket names, or fully-qualified storage references — only the relative storage path.

---

## Implementation Approach

**High-Level Phases:**

1. **Phase 1 — Skeleton & Persistence:** Project structure, DB schema, migration runner, basic API gateway with health check.
2. **Phase 2 — OAuth Vault & Adapter Interface:** Token storage with encryption, platform adapter interface, mock adapter for tests.
3. **Phase 3 — Platform Connections:** Platform OAuth connections (initiate, callback, list, disconnect), concrete Zwift + Strava adapters, token refresh logic.
4. **Phase 4 — Sync Orchestrator:** Cron poller (Zwift), Strava webhook ingestion, sync worker, retry queue, rate-limit budget.
5. **Phase 5 — Deduplication Engine:** Scoring algorithm, merge logic, pending-confirmation surface.
6. **Phase 6 — Push Notification Service:** APNs/FCM integration, device token registry.
7. **Phase 7 — Hardening & Compliance:** Observability, alerts, GDPR export/delete, audit log archival, load tests, security review.

**Dependencies & Blockers:**

- [x] Backend tech stack decision (language, framework, hosting) — **Resolved:** TypeScript + SST v4 (Ion) + Cloudflare (see plan.md, research.md)
- [ ] User authentication strategy for FitHub itself (`001-user-authentication` feature) — assumed to exist; can be stubbed for early phases
- [x] Encryption key management — **Resolved:** Workers Secrets with AES-256-GCM app-layer encryption (see AD-1, NFR-1)
- [ ] APNs and FCM credentials provisioned (Apple Developer + Firebase project)

**Risk Assessment:**

- **Risk 1:** Strava webhook reliability varies (delivery delays, occasional misses). → **Mitigation:** Hourly reconcile poll catches missed events.
- **Risk 2:** Deduplication false positives merge unrelated activities. → **Mitigation:** Conservative auto-merge threshold (>85%); 70-85% requires user confirmation; activity_sources retains raw payload for un-merge.
- **Risk 3:** Token theft via backend breach affects all users (vs. on-device storage which limits blast radius to one device). → **Mitigation:** AES-256-GCM encryption at rest, master key in Workers Secrets with versioned ciphertext format, audit logging, anomaly detection on token use; defense in depth.
- **Risk 4:** Zwift API changes break adapter. → **Mitigation:** Versioned adapter interface; raw payload storage allows re-extraction; integration tests against Zwift sandbox.
- **Risk 5:** Sync queue grows unbounded under sustained external API outage. → **Mitigation:** 24-hour total retry window cap; alert when queue depth exceeds threshold.
- **Risk 6:** Cost of polling thousands of users every 30 min. → **Mitigation:** Adaptive cadence (slow down for inactive users); webhook-first where supported.

---

## Testing Strategy

**Unit Tests:**

- Token encryption round-trip
- Token refresh scheduler logic
- Deduplication scoring across boundary cases (84%, 85%, 86%; 69%, 70%, 71%)
- Platform adapter mock implementations
- Retry backoff calculator (5m → 15m → 30m → 1h, capped at 24h)
- Error classifier (transient vs permanent)
- Per-field fidelity ranking in dedup merge

**Integration Tests:**

- OAuth flow against Zwift sandbox (initiate → callback → token stored)
- OAuth flow against Strava sandbox
- Sync orchestrator: schedule poll, fetch, ingest, emit push
- Webhook handler: Strava webhook → fetch activity → dedup → store
- Apple Health ingest: POST payload → store → dedup → push
- Retry queue: simulate transient failure, verify backoff and recovery
- Disconnect: revoke token, delete vault entry, optional data deletion
- Re-auth flow: invalidate token, verify connection flagged, verify reconnect resets state

**End-to-End Tests:**

> **Note (E1 — OAuth callback model):** The backend `POST /api/connections/:platform/oauth/callback` endpoint is never the direct browser redirect target. The OAuth provider redirects to the **Astro web frontend** (`GET /oauth/callback?code=&state=`), which then calls `POST /api/connections/:platform/oauth/callback` server-side. All E2E tests should reflect this two-hop model, routing the OAuth redirect through the web fixture before calling the backend.

- Web client fixture connects Zwift → backend polls → user fetches activities → displays
- Same activity arrives from Zwift and Strava → dedup auto-merges → web shows one activity with two source badges
- Activity from Apple Watch (Apple Health) and Strava → dedup decides → web reflects decision
- Worker eviction mid-sync → in-flight jobs resume from durable Cloudflare Queues

**Manual / Operational Testing:**

- [ ] Token vault correctly encrypted at rest (verify by inspecting DB rows)
- [ ] Workers Secrets key rotation does not break existing tokens
- [ ] Push notifications deliver on iOS and Android in <60s
- [ ] Audit log captures every token operation
- [ ] No PII appears in application logs (sample 10k log lines)
- [ ] Load test: 10,000 concurrent users at 30-min poll cadence sustained for 1 hour

---

## Success Metrics

- **Metric 1 (Latency):** End-to-end latency from platform event to mobile push <5 min P95.
- **Metric 2 (Reliability):** 99.5% uptime over 30 days, measured by external synthetic checks.
- **Metric 3 (Sync Success):** ≥99% of scheduled polls complete successfully within their window.
- **Metric 4 (Dedup Accuracy):** False-positive merge rate <1% measured against labeled test set; false-negative rate <5%.
- **Metric 5 (Push Delivery):** ≥98% of pushes delivered to active devices within 60 seconds.
- **Metric 6 (Security):** Zero critical findings in security review; 100% of tokens encrypted at rest.
- **Metric 7 (Test Coverage):** ≥80% unit-test coverage; all 10 acceptance criteria covered by automated tests.

---

## Open Questions & Decisions

- **Q1: Backend tech stack (language, framework, hosting platform)?**
  - **Resolution:** TypeScript + Hono + SST v4 (Ion) on Cloudflare Workers / D1 / Queues / R2. Decision locked and recorded in `.specify/memory/tech-stack.md`.

- **Q2: How does FitHub itself authenticate users (separate from platform OAuth)?**
  - **Resolution:** Out of scope for this spec. Assumed to be defined in a future `001-user-authentication` feature. For early phases, a stubbed identity (e.g., dev token) is acceptable.

- **Q3: Data retention policy — how long to keep raw payloads and historical activities?**
  - **Resolution:** Default: indefinite for canonical fields; raw payloads compressed after 1 year. Configurable per user (paid tier may keep raw forever). Detailed retention policy deferred to compliance review.

- **Q4: Should the backend support a web client in MVP?**
  - **Resolution:** Yes — resolved by the 2026-05-06 pivot. The v1 client is the Astro web app (`005-web-frontend`). Native mobile is deferred to v2+.

- **Q5: How does the user un-merge an incorrectly auto-merged activity?**
  - **Resolution:** Out of scope for v1 backend foundation. Raw payloads in `activity_sources` preserve the data needed to un-merge later. UX deferred to v1.1.

- **Q6: Multi-region deployment for latency and compliance?**
  - **Resolution:** Single region for MVP. Multi-region deferred to v2+ when user base justifies cost.

---

## Approval & Sign-Off

- [ ] Architecture review: _________________________ Date: _______
- [ ] Security review: _____________________________ Date: _______
- [ ] Product/stakeholder approval: ________________ Date: _______
- [ ] Ready to move to planning: __________________ Date: _______

---

## Related Documents

- Constitution: `.specify/memory/constitution.md`
- Architecture Overview: `.specify/memory/architecture-overview.md`
- Tech Stack: `.specify/memory/tech-stack.md` (to be updated with backend stack)
- Dependent Features:
  - `.specify/specs/002-zwift-oauth/` — Will be revised to depend on this foundation
  - `.specify/specs/003-strava-oauth/` — Will be revised to depend on this foundation
  - `.specify/specs/004-apple-health-integration/` — Will be revised to depend on this foundation
- Implementation Plan: `plan.md` (to be created)
- Task Breakdown: `tasks.md` (to be created)
