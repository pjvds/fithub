# FitHub Architecture Overview

**Status:** Approved (v1.1)
**Last Updated:** 2026-05-06
**Authority:** This document is the canonical architectural reference. All specs, plans, and tasks must align.

> **Pivot (2026-05-06):** The user-facing client for v1 is a **web app (Astro on Cloudflare)** hosted in the same SST project as the backend. Native mobile is **postponed**. Apple Health integration is postponed with mobile (HealthKit is iOS-only). Sections below have been updated; references to "mobile" generally now mean "client" (web for v1, mobile when revived). Diagrams and flow examples involving Apple Health remain documented as **postponed flows** for future reference.

---

## 1. System Boundaries

FitHub is a **hybrid client-server** fitness data platform composed of three tiers:

```
┌───────────────────────────────────────────────────────────────────┐
│                       External Platforms                           │
│   ┌──────────┐    ┌──────────┐    ┌──────────────────┐  ┌──────┐  │
│   │  Zwift   │    │  Strava  │    │ Apple Health     │  │Future│  │
│   │   API    │    │   API    │    │ (POSTPONED w/    │  │ ...  │  │
│   │          │    │          │    │  native mobile)  │  │      │  │
│   └────┬─────┘    └────┬─────┘    └──────────────────┘  └──────┘  │
└────────┼───────────────┼──────────────────────────────────────────┘
         │ OAuth + REST  │ OAuth + Webhooks
         │ (server-side) │ (server-side)
┌────────▼───────────────▼──────────────────────────────────────────┐
│         FitHub Backend (SST on Cloudflare)                         │
│  ┌────────────────────────────┐                                    │
│  │  OAuth Token Vault         │                                    │
│  │  Platform Adapters         │                                    │
│  │  Sync Orchestrator         │                                    │
│  │  Deduplication Engine      │                                    │
│  │  Canonical Activity Store  │                                    │
│  │  API Gateway               │                                    │
│  └────────────────────────────┘                                    │
└────────┬───────────────────────────────────────────────────────────┘
         │ HTTPS + JSON (cookies for session)
         │
┌────────▼──────────────────────────────────────────────────────────┐
│                  Web App (Astro on Cloudflare)                     │
│   ┌──────────────────────────────────────────────────────────┐    │
│   │  Static pages + islands (auth gate, dashboard, history,  │    │
│   │  manual sync, settings)                                  │    │
│   └──────────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────────┘

Future client tier (postponed):
┌───────────────────────────────────────────────────────────────────┐
│                  Mobile App (framework TBD)                        │
│   - Re-introduces Apple Health / HealthKit integration            │
│   - Re-introduces push notifications (APNs/FCM)                   │
│   - Local read cache (SQLite or equivalent)                       │
└───────────────────────────────────────────────────────────────────┘
```

---

## 2. Architectural Decisions

### AD-1: Hybrid Backend-Driven Architecture

**Decision:** Backend is the source of truth for cloud-platform data. For v1 the only client is the **web app** (read-only consumer of the backend). Device-local data sources (Apple Health, future Health Connect) are postponed with native mobile.

| Data Source | Owner | Token Storage | Sync Direction (v1) |
|-------------|-------|---------------|---------------------|
| Zwift | **Backend** | Backend vault | Backend pulls → web/api reads |
| Strava | **Backend** | Backend vault | Backend pulls (webhook + poll) → web/api reads |
| Apple Health | **Postponed (mobile)** | N/A | Postponed; revisit with native mobile |
| Health Connect | **Postponed (mobile, v2+)** | N/A | Postponed; revisit with native mobile |

**Rationale:**
- Cloud platforms (Zwift, Strava) have stable APIs accessible from a server, so centralizing them avoids each device hammering the API independently and respects rate limits centrally.
- Apple Health is fundamentally device-local (HealthKit data does not exist outside the device), so it requires a native client; the web has no equivalent.
- Backend becomes the consolidated, deduplicated, canonical store accessible from any client.

**Implications (v1):**
- Backend infrastructure is required from day 1 (not deferred).
- OAuth tokens for Zwift/Strava live server-side, encrypted at rest. The web client never sees them.
- The web client is a thin consumer of the JSON API; it has no local persistence beyond browser session cookies and HTTP cache.
- Cross-device "sync" is trivially solved: any browser logged in to the same account sees the same data.

**Implications (when mobile resumes):**
- Apple Health / Health Connect ingestion endpoints (e.g., `POST /api/health/upload`) are **specified in the architecture but not implemented in v1**. They become real once a native client revives.
- Push notifications (APNs/FCM) are specified architecturally (events `activity.created`, `connection.degraded`, etc. already exist) but no Push Notification Worker is built in v1.

### AD-2: Lossless Canonical Activity Model

**Decision:** Store both the raw platform payload AND extracted canonical fields for every activity.

**Schema:**
```sql
CREATE TABLE activities (
  id              UUID PRIMARY KEY,
  user_id         UUID NOT NULL,
  -- Canonical fields (extracted, indexed, queryable)
  type            TEXT NOT NULL,         -- canonical: running, cycling, swimming, hiking, walking, other
  started_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ NOT NULL,
  duration_s      INTEGER NOT NULL,
  distance_m      REAL,
  calories_kcal   REAL,
  avg_heart_rate  INTEGER,
  -- Provenance
  primary_source  TEXT NOT NULL,         -- 'zwift', 'strava', 'apple_health'
  -- Lossless audit
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE activity_sources (
  id                 UUID PRIMARY KEY,
  activity_id        UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  source             TEXT NOT NULL,      -- 'zwift', 'strava', 'apple_health'
  source_activity_id TEXT NOT NULL,      -- platform's ID
  raw_payload        JSONB NOT NULL,     -- original API response, unmodified
  fetched_at         TIMESTAMPTZ NOT NULL,
  schema_version     INTEGER NOT NULL,   -- for re-normalization on schema changes
  UNIQUE (source, source_activity_id)
);
```

**Rationale:**
- Re-normalization is possible without re-fetching from external APIs (saves rate limits, enables schema evolution).
- Platform-specific richness (Zwift power curves, Strava segments, HealthKit HR samples) is preserved for future features.
- Audit trail: we can always prove what the source platform said vs. what we displayed.
- One canonical activity, many source records: cleanly supports the multi-source merge model.

**Trade-offs:**
- Storage cost: ~2-3x larger than canonical-only. Mitigation: JSONB compression in Postgres; optional TTL on `raw_payload` for activities older than 1 year (configurable, paid tier may keep forever).

### AD-3: Sync Orchestration (Backend Pull + Webhooks; Client-Pull Reads)

**Decision:** Backend orchestrates all cloud-platform sync. The v1 web client reads via HTTP (no push). Push notifications are postponed to the mobile spec.

**Per-platform mechanism:**

| Platform | Mechanism | Cadence |
|----------|-----------|---------|
| **Zwift** | Backend polls `/api/activities` per user | Every 30 min |
| **Strava** | Backend subscribes to webhook; falls back to polling | Webhook (instant) + 60 min reconcile poll |
| **Apple Health** | *Postponed.* Mobile observes `HKObserverQuery` deltas; pushes to backend | (real-time on workout end, when mobile resumes) |

**v1 client refresh flow (web):**
```
User loads dashboard
  → Web app GETs /api/activities?since=<cursor> on page load and on focus
  → Manual sync button POSTs /api/sync/trigger
  → Optional later: SSE or Web Push for live updates
```

**Future client refresh flow (mobile, postponed):**
```
Backend completes sync → silent APNs/FCM push → mobile fetches /api/activities/since=<cursor>
```

**Manual sync:** Any client (web v1, mobile future) can call `POST /api/sync/trigger` to force backend to poll immediately.

**Rationale:**
- Backend handles rate limits centrally (e.g., one Strava token = 600 req/hr shared across all user devices).
- Webhooks (Strava) reduce latency from 30 min → seconds when supported.
- For v1 web, simple client-pull is sufficient; the cost/complexity of Web Push or SSE isn't justified for an authed dashboard that users open intentionally.
- Apple Health is necessarily client-driven because HealthKit data only exists on the device — postponed with mobile.

### AD-4: Multi-Source Activity Resolution (Merge with Source Refs)

**Decision:** When the same workout arrives from multiple sources, merge into one canonical activity with N source references.

**Algorithm:**
1. For every newly fetched activity, the **Deduplication Engine** computes a confidence score against existing activities for the same user, scoped to a ±15 min time window:
   - Type match: 30 points
   - Start time within ±5 min: 30 points
   - Duration within ±10%: 25 points
   - Distance within ±5%: 15 points
2. Resolution by score:
   - **>85%** → Auto-merge: link new source to existing canonical activity
   - **70-85%** → Flag for user confirmation in client UI (web v1; mobile when revived)
   - **<70%** → Treat as separate activity

**Canonical field selection (when merging):** Per field, choose the source with highest fidelity for that field type:
- Distance/pace/power/cadence: Strava > Zwift > Apple Health (Strava typically richest)
- Heart rate samples: Apple Health > Strava > Zwift (HealthKit has watch-level granularity)
- Activity type: First reporter wins (rarely disagrees)
- Calories: Apple Health > Strava > Zwift (HealthKit has personalized models)

**User-visible:** UI shows one activity card with source badges (e.g., 🚴 Zwift + 🏃 Strava + ❤️ Apple Health).

---

### AD-5: Event-Driven Architecture (Outbox + Cloudflare Queues + R2)

**Decision:** All domain state changes propagate through an internal event bus rather than direct service-to-service calls. Consistency between D1 (source of truth) and the bus is guaranteed by the **transactional outbox pattern**, which is Cloudflare's officially documented best practice for D1 + Queues.

**Topology:**

1. A Worker writes the domain state change AND an outbox row to D1 in a single `db.batch([...])` (atomic SQLite transaction).
2. A scheduled **Outbox Relay Worker** drains `outbox_events` rows in batches and publishes them to **Cloudflare Queues**, marking rows with `processed_at` after successful enqueue. Processed rows are retained (not deleted) as an audit/replay trail; automated sweep is deferred to post-MVP.
3. Subscribers (Worker consumers bound to the queue) react: dedup engine, push notifier, audit log writer, future analytics, etc.

**Event payload contract:**
- All events MUST conform to the **CloudEvents v1.0 JSON specification** (CNCF standard). Every event carries the required CloudEvents attributes (`specversion`, `id`, `source`, `type`, `time`) plus domain-specific `data`. Zod schemas validate the `data` payload per event type at both publish and consume boundaries.
- Events MUST be small (target ≤4 KB JSON; absolute limit aligns with Cloudflare Queues message size).
- Events carry **identifiers and references**, not bulk data.
- Large binary artifacts (FIT/TCX files, raw platform API responses) are stored in **R2**.
- Events reference blobs by **storage path only** — e.g., `"raw_fit_path": "users/abc-123/activities/act-789/raw.fit"`. Events MUST NOT include:
  - Fully-qualified R2 URLs (e.g., `https://...r2.cloudflarestorage.com/...`)
  - Bucket names or account-scoped identifiers
  - Provider-specific URIs (e.g., `r2://bucket/key`)
  
  Rationale: a path-only reference preserves storage-backend independence. The R2 binding lives in the consumer Worker's environment; if the storage layer is ever swapped (e.g., to S3 or another provider), event schemas remain unchanged.

**Per-entity ordering:** When a subscriber needs strict per-user ordering (e.g., dedup decisions on rapid-fire ingests), it routes to a **Durable Object** keyed by `user_id`. The DO acts as a single-writer serializer.

**Naming convention:** Events use past-tense, dot-namespaced names: `activity.ingested`, `activity.merged`, `connection.created`, `connection.revoked`, `health_upload.received`, `sync_job.completed`, `sync_job.failed`, `user.deleted`, `user.export_ready`.

**Delivery & idempotency:**
- Cloudflare Queues provides **at-least-once** delivery — consumers may receive the same message more than once.
- Every CloudEvents `id` (UUID, assigned at outbox insert time) serves as the **idempotency key**. Each consumer tracks processed event IDs in a `processed_events` D1 table with columns `(consumer_id, event_id, processed_at)`.
- **Bounded-window cleanup:** A daily cron sweep (piggybacked on the Outbox Relay Worker schedule) deletes `processed_events` rows older than **24 hours**.
- **Safety invariant:** The cleanup window (24h) MUST always exceed the Cloudflare Queues maximum retry window (currently 12h). This guarantees that a successfully-processed event's dedup row can never be garbage-collected before Queues stops retrying it — so duplicate delivery after cleanup is impossible.
- **Extended outage (>12h):** If a consumer is offline beyond the retry window, undelivered messages move to the **dead-letter queue (DLQ)** rather than being silently dropped. DLQ replay re-introduces them as fresh deliveries with the original `event_id`. If the `processed_events` row still exists (outage < 24h), dedup catches it. If the row was already cleaned up (outage > 24h), the event was never processed, so processing it now is correct — not a duplicate.
- **Per-user ordering** is handled by Durable Objects (see above), so no global ordering guarantees from Queues are required.

**What this replaces:** The earlier implicit "side-channel + direct call" pattern. AD-5 makes the bus the canonical inter-service contract.

**What this does NOT change:** D1 remains the source of truth (read path is unchanged); REST API contracts are client-agnostic — same endpoints serve the v1 web app and any future mobile client.

**Event scope:** Only business-significant state changes emit domain events. The decision criteria: *"Does another service or the end user need to react to this?"* If yes, emit. If only the owning Worker cares, handle internally.

**Canonical event catalogue:**

| Event | Emitter | Subscribers |
|---|---|---|
| `activity.ingested` | Platform Adapters | Dedup Engine |
| `activity.created` | Dedup Engine | Activity Store *(Push Notifier: postponed)* |
| `activity.merged` | Dedup Engine | Activity Store *(Push Notifier: postponed)* |
| `connection.created` | Auth Worker | Sync Orchestrator |
| `connection.revoked` | Auth Worker / API | Sync Orchestrator *(Push Notifier: postponed)* |
| `connection.degraded` | OAuth Token Vault | Sync Orchestrator *(Push Notifier: postponed)* |
| `health_upload.received` | API Gateway | Dedup Engine *(postponed with mobile)* |
| `sync_job.completed` | Sync Orchestrator | *(Push Notifier: postponed)* |
| `sync_job.failed` | Sync Orchestrator | Alerting *(Push Notifier: postponed)* |
| `token.refresh_failed` | OAuth Token Vault | Connection Manager *(Push Notifier: postponed)* |
| `user.deleted` | API (GDPR deletion) | Sync Orchestrator, Alerting *(Push Notifier: postponed)* |
| `user.export_ready` | Export Worker | *(Push Notifier: postponed; web shows status via dashboard polling)* |

> **Note:** The Push Notifier subscriber is **postponed** with native mobile. Events are still emitted in v1 — the bus is decoupled from subscribers, so adding the Push Notifier later requires no producer-side change. Web v1 surfaces the same state via dashboard polling against the read API.

Events NOT emitted (internal): `token.refreshed`, `sync_job.retrying`, `activity.dedup_skipped`, `cache.invalidated`.

---

## 3. Component Responsibilities

### Backend Components

- **OAuth Token Vault** — Encrypted storage (AES-256-GCM, app-layer) for Zwift/Strava access + refresh tokens in D1. Auto-refresh tokens before expiry. Tokens never leave backend.
- **Platform Adapters** — Per-platform modules (`ZwiftAdapter`, `StravaAdapter`) implementing common `PlatformAdapter` interface (fetch_activities, get_profile, validate_token). Persist raw API payloads to R2; emit `activity.ingested` events with R2 path refs (see AD-5).
- **Sync Orchestrator** — Cron-driven scheduling, webhook handling, retry queue with exponential backoff (5m → 15m → 30m → 1h, capped at 24h). Emits `sync_job.completed` / `sync_job.failed` events.
- **Deduplication Engine** — Subscribes to `activity.ingested` events. Computes match scores, links/merges per AD-4. Coordinated per-user via a Durable Object to serialize concurrent ingests. Emits `activity.merged` / `activity.created` events.
- **Canonical Activity Store** — D1 tables (`activities`, `activity_sources`, plus `outbox_events`). Source of truth for cloud data (Zwift, Strava). *Apple Health ingestion postponed with mobile.*
- **Blob Store (R2)** — FIT/TCX files and raw platform API payloads. Path convention: `users/<user_id>/activities/<activity_id>/<artifact>`. Referenced from events by path only.
- **Outbox Relay Worker** — Cron-driven; drains `outbox_events` from D1 to Cloudflare Queues with exactly-once-publish semantics (idempotent re-runs). Marks rows with `processed_at` after successful enqueue; rows are retained (not deleted) as an audit/replay trail. Automated sweep deferred to post-MVP.
- **Domain Event Bus (Cloudflare Queues)** — Inter-service contract for all state-change propagation.
- **Push Notification Service** — *POSTPONED with native mobile.* Will subscribe to `activity.*` and `connection.*` events when revived.
- **API Gateway** — REST endpoints (v1): `/api/connections`, `/api/activities`, `/api/sync/trigger`. *`/api/health/upload` specified but not exposed until mobile resumes.*

### Web Components (v1)

- **Astro App (`web/`)** — Static-first; islands hydrate the auth gate, dashboard, sync history, manual sync button, and settings.
- **API Client** — Typed `fetch` wrappers over `/api/*` using shared Zod schemas from `@fithub/core`.
- **Auth Gate** — Redirects unauthenticated users to `auth.fithub.space`; reads session via `HttpOnly` cookie.
- **Refresh Strategy** — On page load and on focus; manual "Sync now" button calls `POST /api/sync/trigger`.

### Future Mobile Components (postponed)

> Original v1 plan retained as reference; not implemented until mobile spec returns.

- **Cloud Sync Client** — Receives push, fetches `/api/activities?since=...`, updates local SQLite.
- **HealthKit Observer (iOS)** — Registers `HKObserverQuery` for workouts. On new workout: pushes to `POST /api/health/upload`.
- **Local SQLite Cache** — Read-optimized projection of backend data for offline access. Not source of truth.
- **OAuth Connect Flow** — Launches system browser for Zwift/Strava OAuth.
- **UI Layer** — Activity feed, source badges, manual sync, settings.

---

## 4. Data Flow Examples

> All flows below assume AD-5: state changes are persisted via D1 outbox → Queues → subscribers. Blob payloads (raw FIT, raw API JSON) live in R2 and are referenced from events by path only.

### Example 1: Zwift activity completed
```
1. User finishes Zwift ride.
2. (≤30 min later) Sync Orchestrator (Cron Worker) polls Zwift API for user.
3. Zwift Adapter writes raw payload to R2 at
     users/<uid>/activities/<aid>/raw.json
4. In one D1 batch: insert activity_sources row + insert outbox_events row
     event: activity.ingested
     payload: { user_id, activity_source_id, platform: "zwift",
                raw_path: "users/<uid>/activities/<aid>/raw.json" }
5. Outbox Relay Worker (cron, ~5s cadence) drains outbox → Cloudflare Queues.
6. Dedup Worker consumes activity.ingested → routes to per-user Durable Object →
     no existing match → creates canonical activity → emits activity.created.
7. *(Push Notifier postponed.)* Web client picks up the change on next refresh:
     user reloads dashboard or focuses the tab → GET /api/activities?since=<cursor>.
```

### Example 2: Same ride also synced to Strava (~5 min later)
```
1. Strava webhook fires → API Gateway receives event.
2. Strava Adapter fetches activity detail, writes raw JSON + FIT to R2.
3. D1 batch: insert activity_sources row + outbox row (event: activity.ingested).
4. Outbox Relay → Queues → Dedup Worker (per-user DO) →
     92% match with Zwift activity → emits activity.merged
     payload: { canonical_activity_id, new_source_id, score: 92 }.
5. Field-fusion sub-step (canonical fields updated using AD-4 priorities).
6. Web client picks up "Zwift + Strava" badge on next refresh.
```

### Example 3: Apple Watch logged a separate run *(POSTPONED — preserved for future mobile spec)*
```
[POSTPONED with native mobile. Recorded here for when the mobile client returns.]
1. User completes outdoor run, Apple Watch saves to HealthKit.
2. iPhone wakes from HKObserverQuery, normalizes the sample, uploads to
     POST /api/health/upload (multipart: JSON metadata + optional FIT blob).
3. API Worker writes blob to R2 → D1 batch (activity_sources + outbox row,
     event: health_upload.received).
4. Outbox → Queues → Dedup Worker → no match → activity.created event.
5. Push Notification Worker fans out to user's other devices.
```

---

## 5. Boundary Decisions (What This Document Does NOT Cover)

The following are intentionally deferred and will be addressed in separate ADs as needed:

- **Backend hosting / deployment** (cloud provider, regions, scale targets) — separate ops doc
- **Authentication for the FitHub backend itself** (user accounts, login) — assumed to exist; will be specified in `001-user-authentication` feature
- **Conflict resolution for user edits** (e.g., user manually edits a synced activity) — v2+ feature
- **Data retention / GDPR deletion** — separate compliance doc
- **Health Connect (Android)** — v2+ feature

---

## 6. Cross-References

This document supersedes architectural assumptions in:
- `.specify/specs/002-zwift-oauth/spec.md` — **SUPERSEDED** by future `006-zwift-oauth-web` (web flow); mobile reintroduction TBD.
- `.specify/specs/003-strava-oauth/spec.md` — **SUPERSEDED** by future `007-strava-oauth-web`.
- `.specify/specs/004-apple-health-integration/spec.md` — **POSTPONED** with native mobile.
- `.specify/specs/005-web-frontend/spec.md` — Defines the v1 web client.

Specs/plans/tasks for backend foundation (`000-backend-foundation`) and web frontend (`005-web-frontend`) must align with AD-1 through AD-5 before implementation.

---

**Approved by:** User decision via speckit-analyze remediation
**Constitution alignment:** ✅ All 8 principles compatible
