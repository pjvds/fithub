# Implementation Plan: Backend Foundation

## Plan Overview

**Feature:** Backend Foundation (Reference: `.specify/specs/000-backend-foundation/spec.md`)

**Plan ID:** plan-feat-000-backend-foundation

**Version:** 1.0.0

**Date:** 2026-05-05

**Tech Stack:** TypeScript ^5.6 + SST v4 (Ion) + Cloudflare (Workers, D1, Durable Objects, Queues, KV, R2, Cron Triggers, Secrets)
- **Frameworks/runtimes:** Hono ^4.12, Drizzle ORM ^0.45 + Drizzle Kit ^0.30, Zod ^4, OpenAuth.js ^0.4 (`@openauthjs/openauth`)
- **Testing/tooling:** Vitest ^4 (built-in `bench` for perf regressions), ESLint ^9
- **Local emulation & types:** Provided natively by SST v4 — `sst dev` runs the integrated Miniflare runtime; SST generates Worker binding types from `sst.config.ts` (no `wrangler dev`/`wrangler types`/`@cloudflare/workers-types` required). Wrangler CLI is **optional** and only used for ad-hoc Cloudflare operations outside the SST workflow (e.g., `wrangler tail` for live log streaming, `wrangler d1 execute` for one-off queries).
- **Versions verified:** May 2026 — pin minimums in `package.json`; track latest with Renovate/Dependabot

---

## Problem & Approach

**Feature Problem:**
FitHub's hybrid architecture (per `.specify/memory/architecture-overview.md`) requires a backend that holds OAuth tokens for cloud platforms, polls/receives webhooks, deduplicates activities across sources, and pushes notifications to mobile clients. Without this, none of the three platform integrations (Zwift, Strava, Apple Health) can be implemented.

**Implementation Approach:**
Build a serverless TypeScript backend on Cloudflare, deployed via SST. Map each spec subsystem to native Cloudflare primitives that minimize operational burden:

- **API Gateway, webhook handlers** → Workers (Hono framework)
- **Per-user sync coordination** → Durable Objects (one DO instance per user, single-writer guarantee)
- **Persistent retry queue + domain event bus** → Cloudflare Queues (with delayed delivery, DLQ, and event fan-out)
- **Scheduled polling + outbox relay** → Cron Triggers (30-min Zwift polls + ~5s outbox drain)
- **Canonical activity store + transactional outbox** → D1 (SQLite at edge; atomic `db.batch([...])` for state + outbox writes)
- **Hot caches** → Workers KV
- **Blob storage (FIT/TCX, raw API payloads)** → R2 (events reference blobs by path only, never URLs)
- **Secrets** → Workers Secrets + app-layer AES-256-GCM for OAuth tokens
- **Event schema** → CloudEvents v1.0 JSON + Zod validation

The architecture is structured around four logical service boundaries within a single SST app:
1. **`api`** Worker — Mobile-facing HTTP API + Strava webhook receiver
2. **`scheduler`** Worker — Cron-triggered Zwift polling dispatcher
3. **`worker`** Worker — Queue consumer for sync jobs + retry processing
4. **`auth`** Worker — OpenAuth.js (SST Auth) issuer hosting Apple/Google/email-magic-link sign-in flows; issues JWTs validated by `api`

Each user has a `UserSyncCoordinator` Durable Object holding sync state (last cursor per platform, pending dedup queue, push tokens).

All domain state changes propagate through the system as events via the **D1 transactional outbox pattern → Cloudflare Queues** (AD-5). Events conform to CloudEvents v1.0 JSON, carry ≤4 KB payloads, and reference R2 blobs by storage path only. An Outbox Relay Worker drains the outbox to Queues on a ~5s cron cadence. Consumers dedup using the CloudEvents `id` as idempotency key with a 24h bounded-window cleanup (safe because Queues max retry window is 12h < 24h cleanup window).

User authentication for FitHub itself is provided by **self-hosted OpenAuth.js** (the `auth` Worker) using Workers KV for issuer state and D1 for the canonical `users` table. Mobile uses `flutter_appauth` (PKCE) to obtain JWTs; `api` validates JWTs on every request.

Eight phases sequenced (see Implementation Breakdown below for the canonical phase numbering): Phase 1 establishes SST project + D1 schema + outbox infrastructure + JWT validation middleware; Phase 2 builds OAuth Token Vault + adapter interface; Phase 3 adds Zwift adapter + cron-driven polling; Phase 4 adds Strava adapter + webhooks; Phase 5 builds the dedup engine; Phase 6 adds push notifications; Phase 7 adds Apple Health ingestion; Phase 8 hardens (observability, security, load testing). FitHub user authentication itself (the OpenAuth `auth` Worker for Apple/Google/email-magic-link sign-in) is specified in feature `001-user-authentication` — it is a hard dependency of this foundation but specified and tracked separately.

---

## Design Decisions & Rationale

### Decision 1: Durable Objects for Per-User Sync Coordination

**Choice:** Use Cloudflare Durable Objects (one instance per user, keyed by user_id) to hold sync state and serialize concurrent operations.

**Rationale:**
- Sync orchestration requires single-writer semantics per user (e.g., "is a Zwift poll already in flight?", "what's the last cursor?")
- Without DOs, coordinating across stateless Workers requires external locks (Redis), adding infra
- DOs provide free serialization, persistent local state, and edge locality
- Cost-effective: DOs scale to zero per user; only billed when active

**Constitution Alignment:**
- §4 Reliability — Single-writer prevents race conditions during sync
- §5 Performance — Edge locality reduces latency

**Alternatives Considered:**
- Redis + Workers: adds infra, additional failure mode
- Stateless Workers + optimistic locking in D1: complex, prone to bugs
- Single-region scheduler service: defeats Cloudflare's edge model

**Impact:** Adds DO concept to learning curve; requires careful design of DO interface (RPC-style); state migrations need a versioning scheme.

---

### Decision 2: Cloudflare Queues for Retry & Sync Job Distribution

**Choice:** Use Cloudflare Queues for: (a) dispatching sync jobs from cron/webhook to worker, and (b) implementing the retry queue with delayed delivery.

**Rationale:**
- Native Cloudflare primitive — no extra infra
- Built-in delayed delivery supports exponential backoff (5m → 15m → 30m → 1h)
- Built-in DLQ catches messages exceeding max retries
- Queues survive backend "restarts" inherently (serverless: there are no traditional restarts)
- Per-message retry counters available

**Constitution Alignment:**
- §4 Reliability — Persistent queue across infrastructure events
- §2 Cross-Platform Integration — Centralized retry/backoff per spec

**Alternatives Considered:**
- DO-based queue: works but DO storage is per-instance; harder to drain/inspect
- D1 polled job table: requires polling Worker; more code, more cost
- External queue (SQS, RabbitMQ): defeats single-platform simplicity

**Impact:** Need to design message schema (sync job envelope) carefully; retry logic lives in queue consumer.

---

### Decision 3: D1 with Drizzle ORM for Canonical Store

**Choice:** Use D1 (Cloudflare's SQLite) as the primary database, accessed via Drizzle ORM for type-safe queries.

**Rationale:**
- D1 is read-replicated globally and reads from the nearest replica → low latency from Workers
- SQLite syntax is familiar and fits relational schema (users, connections, activities, activity_sources)
- Drizzle ORM provides TypeScript types from schema, migrations, and zero-runtime overhead (compiles to SQL)
- Schema versioning via Drizzle migrations + raw SQL escape hatch when needed

**Constitution Alignment:**
- §6 Code Quality — Type-safe queries catch bugs at compile time
- §5 Performance — Local read replicas reduce latency

**Alternatives Considered:**
- Raw SQL with `prepare`/`bind` API: works but loses type safety
- Cloudflare KV-only: insufficient for relational queries (joins, complex filters)
- External Postgres (Neon, Supabase): adds vendor + latency tax
- Hyperdrive + external DB: heavier than necessary for MVP volumes

**Impact:** D1 has size and write-throughput limits (currently generous; monitor); JSON functions via SQLite JSON1 extension; complex queries may need raw SQL escape hatch.

---

### Decision 4: Hono as HTTP Framework

**Choice:** Use Hono for routing, middleware, and request handling in API Workers.

**Rationale:**
- Designed for Workers; minimal cold-start overhead
- Express-like API; widely understood
- First-class TypeScript support
- Middleware ecosystem (auth, validation, CORS)
- Smaller bundle than alternatives → faster cold starts

**Constitution Alignment:**
- §5 Performance — Low overhead at the edge
- §6 Code Quality — Type-safe handlers

**Alternatives Considered:**
- itty-router: smaller but less ergonomic; fewer middleware
- Worktop: less actively maintained
- Custom Worker: too much boilerplate

**Impact:** Adds one dependency; team needs to learn Hono idioms (similar to Express).

---

### Decision 5: App-Layer AES-256-GCM Encryption for OAuth Tokens

**Choice:** Encrypt OAuth tokens with AES-256-GCM in the application layer before writing to D1, using a master key stored in Workers Secrets.

**Rationale:**
- Defense in depth: D1 is encrypted at rest by Cloudflare, but app-layer encryption protects against accidental log leaks, DB exports, and developer access to raw rows
- GCM provides authenticated encryption (detects tampering)
- WebCrypto API available natively in Workers (no third-party crypto dependency)
- Master key rotation possible by versioning ciphertexts

**Constitution Alignment:**
- §1 Data Privacy & Security — AES-256 minimum requirement met (and exceeded with GCM)

**Alternatives Considered:**
- Rely solely on D1 at-rest encryption: insufficient defense in depth
- External KMS (AWS KMS, GCP KMS): adds latency and cross-cloud dependency
- Encrypt entire row: harder to query metadata (created_at, etc.)

**Impact:** Implement crypto helper module (`encrypt`, `decrypt`); design ciphertext format (`v1:iv:ciphertext:tag`); plan for key rotation procedure.

---

### Decision 6: Hybrid Push Strategy (APNs/FCM Direct + Mobile Polling Fallback)

**Choice:** Send silent pushes via APNs (iOS) and FCM (Android) directly from Workers using HTTP/2 APIs. Mobile fetches `/api/activities?since=cursor` on push receipt and on every app foreground (fallback for missed pushes).

**Rationale:**
- Direct HTTP/2 APIs avoid third-party push services (cost + privacy)
- Silent pushes wake mobile sync client without user-visible notification
- Foreground fetch on every app open handles missed pushes (delivery is best-effort)
- Single source of truth: backend cursor → mobile cursor

**Constitution Alignment:**
- §5 Performance — <60s push latency target met
- §1 Data Privacy — No third-party push relays

**Alternatives Considered:**
- Firebase Cloud Messaging for both platforms (FCM-to-APNs proxy): simpler but adds dependency on Firebase
- Polling-only: 30-min cadence too slow for §5 latency target
- WebSockets/SSE: overkill for low-frequency events; mobile battery cost

**Impact:** Need APNs JWT auth token generation logic; FCM v1 API uses OAuth2 service account; both must be implemented as Worker modules.

---

### Decision 7: Single SST App with Multiple Workers

**Choice:** Single SST application defining all backend resources (Workers, D1, DOs, Queues, KV, Secrets). Four logical Workers within: `api`, `scheduler`, `worker`, `auth`.

**Rationale:**
- Shared types and utilities across Workers (encryption, dedup engine, JWT verification helpers)
- Single deployment unit; consistent versioning
- SST manages cross-resource references and bindings
- Per-environment config (`dev`, `staging`, `production`) via SST stages
- `auth` Worker hosted at separate subdomain (`auth.fithub.app`) for clean OAuth redirect URIs and CSP isolation

**Constitution Alignment:**
- §6 Code Quality — Shared code reduces duplication
- §7 Transparency — Single deploy unit makes release notes coherent

**Alternatives Considered:**
- Separate SST apps per Worker: more boilerplate, harder to share code
- Monolithic single Worker: violates separation of concerns; cron + queue + API in one is messy

**Impact:** Workspace-style monorepo within `backend/`; build config must produce four Worker bundles.

---

### Decision 8: Apple Health Ingestion via Streaming Batched Endpoint

**Choice:** Mobile uploads Apple Health activities via `POST /api/health/upload` accepting a batch of up to 50 activities per call.

**Rationale:**
- Initial sync from HealthKit may yield hundreds of activities; batching reduces request count
- 50-per-batch keeps payload under Workers' request size limits
- Mobile client paginates internally if needed
- Server returns per-activity dedup outcome (created, merged, conflict-pending)

**Constitution Alignment:**
- §5 Performance — Batching reduces latency and overhead

**Alternatives Considered:**
- One activity per request: too chatty
- Streaming upload: complex on mobile; Workers buffer body anyway
- Larger batches (500): risk hitting size limits, slower per-request response

**Impact:** Mobile client implements batch chunking; backend response schema includes per-activity status array.

---

### Decision 9: OpenAuth.js (SST Auth) for FitHub User Authentication

**Choice:** Self-host OpenAuth.js as a 4th Worker (`auth.fithub.app`). Providers: Sign in with Apple, Sign in with Google, and email magic-link. JWT-based sessions. Workers KV for issuer state (refresh tokens, OTP codes, auth codes). D1 `users` table as canonical user store.

**Rationale:**
- Native Cloudflare Workers support (built-in KV adapter); same stack, single SST deploy
- Self-hosted → zero per-user cost, full data sovereignty (Constitution §1 Data Privacy)
- Open source, made by the SST team — no vendor lock-in
- Standards-based OAuth 2.0 + PKCE; works with existing `flutter_appauth` mobile dependency
- Sign in with Apple satisfies App Store Guideline 4.8 when offering other social logins on iOS
- Magic-link removes the need for password storage in MVP (smaller attack surface; no credential-stuffing exposure)

**Constitution Alignment:**
- §1 Data Privacy — User identity stays on FitHub infrastructure; no third-party identity provider sees user activity
- §6 Code Quality — TypeScript-native; types shared with `api` Worker for JWT claims
- §7 Transparency — Open-source auth provider; behavior fully inspectable

**Alternatives Considered:**
- **Clerk:** great DX, polished mobile widgets, but per-user pricing at scale; data hosted on Clerk's infrastructure
- **Auth0:** enterprise-grade, mature Flutter SDK, but expensive and adds external dependency
- **Roll our own auth:** high security risk; reinventing OAuth flows, MFA, recovery
- **Better Auth:** newer, framework-agnostic, but less mature than OpenAuth on Workers specifically

**Impact:**
- Adds 4th Worker bundle and a Workers KV namespace (`AUTH_KV`)
- Mobile flow: `flutter_appauth` opens `https://auth.fithub.app/authorize?...` in `ASWebAuthenticationSession` (iOS) / `CustomTabs` (Android); receives JWT via PKCE; stores in Keychain/Keystore
- `api` Worker validates JWT (RS256) via OpenAuth's JWKS endpoint
- Magic-link delivery requires email provider (Resend recommended; ~$20/mo at expected volume)
- `001-user-authentication` feature spec details: provider configuration, account linking, JWT claim shape, email templates, deep-link handling

**Open Questions for `001-user-authentication`:**
- Email provider choice (Resend vs Postmark vs SES via worker-mailer)
- Account linking when same email signs in via Apple then Google
- Refresh token TTL and rotation policy
- Optional MFA (deferred to v2)

---

### Decision 10: Event-Driven Architecture (AD-5 — Outbox + Queues + R2)

**Choice:** All domain state changes propagate via a D1 transactional outbox → Cloudflare Queues event bus. Large payloads (FIT/TCX files, raw API responses) stored in R2; events reference blobs by storage path only. Events conform to CloudEvents v1.0 JSON; Zod schemas validate `data` per type.

**Rationale:**
- D1 transactional outbox is Cloudflare's officially documented best practice for guaranteed DB↔bus consistency
- Outbox + Queues replaces direct service-to-service calls, decoupling producers from consumers
- R2 for blobs keeps event payloads small (≤4 KB) while preserving raw data losslessly
- Path-only blob references maintain storage-backend independence
- CloudEvents v1.0 is the CNCF standard; avoids future wire-format migration
- At-least-once delivery + consumer-side idempotency keys (CloudEvents `id`) with 24h bounded-window cleanup; safe because Queues max retry window (12h) < cleanup window (24h)
- Outbox rows marked `processed_at` after enqueue but retained (not deleted) as audit/replay trail; automated sweep deferred to post-MVP
- Domain events only: emit when another service or user must react; internal mechanics stay local

**Constitution Alignment:**
- §4 Reliability — Outbox guarantees no event loss even if Queues is temporarily unavailable
- §2 Cross-Platform Integration — Common event contract across all adapters
- §1 Data Privacy — Raw payloads in R2, not in event payloads; path-only refs prevent URL leakage
- §7 Transparency — Outbox provides built-in audit trail

**Alternatives Considered:**
- Side-channel events (dual-write): no atomicity guarantee on D1 (no LISTEN/NOTIFY)
- Event sourcing: feasible on Cloudflare but painful (no managed event store, expensive replays)
- Hybrid (DB write + best-effort publish): loses events under failure
- Untyped JSON events: high drift risk across 4 Workers

**Impact:** Adds `outbox_events` and `processed_events` tables to D1; adds Outbox Relay Worker (cron); adds R2 bucket; all adapters must write to outbox instead of calling downstream directly; adds CloudEvents + Zod schema package to shared code.

---

## Architecture & Component Changes

**System Diagram:**

```
                                    External
              ┌───────────────────────────────────────────────────┐
              │  Zwift API   │  Strava API + Webhooks  │ APNs/FCM │
              └───┬───────────────┬─────────────────────┬─────────┘
                  │               │                     │
                  │ poll          │ webhook + poll      │ push
                  │               │                     │
       ┌──────────┴───────────────┴─────────────────────┴────────────────┐
       │                  Cloudflare (single SST app)                     │
       │                                                                  │
       │  ┌─────────────────┐    ┌──────────────────┐  ┌──────────────┐  │
       │  │  api  Worker    │    │ scheduler Worker │  │ worker       │  │
       │  │  (Hono)         │    │  (Cron Trigger)  │  │ (Queue cons.)│  │
       │  │                 │    │                  │  │              │  │
       │  │ - JWT verify    │    │ - List active    │  │ - Sync jobs  │  │
       │  │ - /connections  │    │   Zwift conns    │  │ - Retry      │  │
       │  │ - /activities   │    │ - Enqueue jobs   │  │ - Adapter    │  │
       │  │ - /health/upload│    │                  │  │   exec       │  │
       │  │ - /webhooks/*   │    │                  │  │ - Dedup      │  │
       │  │ - /sync/trigger │    │                  │  │ - Push       │  │
       │  └────────┬────────┘    └────────┬─────────┘  └──────┬───────┘  │
       │           │                      │                    │          │
       │  ┌────────┴───────────┐          │                    │          │
       │  │  auth Worker       │          │                    │          │
       │  │  (OpenAuth.js)     │          │                    │          │
       │  │  auth.fithub.app   │          │                    │          │
       │  │ - /authorize       │          │                    │          │
       │  │ - /token           │          │                    │          │
       │  │ - /.well-known/    │          │                    │          │
       │  │   jwks.json        │          │                    │          │
       │  │ - Apple / Google / │          │                    │          │
       │  │   email-magic-link │          │                    │          │
       │  └────────┬───────────┘          │                    │          │
       │           │                      │                    │          │
       │           │   ┌──────────────────┴────────────────────┘          │
       │           │   │                                                  │
       │           ▼   ▼                                                  │
       │   ┌────────────────────────────────────────────────────┐         │
       │   │  Durable Object: UserSyncCoordinator (1 per user)  │         │
       │   │  - sync state per platform (cursors, last_synced)  │         │
       │   │  - in-flight job locks                             │         │
       │   │  - pending-dedup list                              │         │
       │   │  - registered push tokens                          │         │
       │   └────────────────────────────────────────────────────┘         │
       │                                                                  │
       │   ┌─────────────────┐  ┌────────────┐   ┌──────────────────┐    │
       │   │ Queue:          │  │ Queue:     │   │ KV:              │    │
       │   │ sync-jobs       │  │ retry-jobs │   │ feed-cache       │    │
       │   │ (DLQ included)  │  │ (delayed)  │   │ AUTH_KV (issuer) │    │
       │   └─────────────────┘  └────────────┘   └──────────────────┘    │
       │                                                                  │
       │   ┌─────────────────┐  ┌──────────────────────────────────┐    │
       │   │ Queue:          │  │ R2: blob-store                   │    │
       │   │ event-bus       │  │ users/<uid>/activities/<aid>/…   │    │
       │   │ (domain events) │  │ (FIT/TCX, raw API payloads)     │    │
       │   │ (DLQ included)  │  └──────────────────────────────────┘    │
       │   └────────┴────────┘                                           │
       │            ▲ Outbox Relay (Cron ~5s)                             │
       │            │                                                     │
       │   ┌──────────────────────────────────────────────────────────┐  │
       │   │ D1: users, connections, activities, activity_sources,    │  │
       │   │     dedup_pending, audit_log, outbox_events,              │  │
       │   │     processed_events                                      │  │
       │   └──────────────────────────────────────────────────────────┘  │
       │                                                                  │
       │   ┌──────────────────────────────────────────────────────────┐  │
       │   │ Workers Secrets: TOKEN_MASTER_KEY, ZWIFT_CLIENT_SECRET,  │  │
       │   │   STRAVA_CLIENT_SECRET, APNS_PRIVATE_KEY, FCM_SA_JSON,   │  │
       │   │   OPENAUTH_SIGNING_KEY, APPLE_CLIENT_SECRET,             │  │
       │   │   GOOGLE_CLIENT_SECRET, EMAIL_PROVIDER_KEY               │  │
       │   └──────────────────────────────────────────────────────────┘  │
       └──────────────────────────────────────────────────────────────────┘
                                     │
                                     │ HTTPS + Push
                                     ▼
                              ┌─────────────┐
                              │  Mobile App │
                              └─────────────┘
```

**New Components (all new — this is a greenfield backend):**

- **`api` Worker** (Hono) — REST endpoints for mobile + webhook receiver for Strava
- **`scheduler` Worker** (Cron Trigger) — Runs every 30 min; queries D1 for active Zwift connections; enqueues sync jobs
- **`worker` Worker** (Queue consumer) — Processes sync jobs; calls platform adapters; runs dedup; emits pushes
- **`UserSyncCoordinator` Durable Object** — Per-user sync state (cursors, locks, pending dedup, push tokens)
- **Platform adapters** (modules, not Workers) — `ZwiftAdapter`, `StravaAdapter`, `AppleHealthAdapter` implementing common interface
- **Deduplication module** (shared library) — Pure functions; consumed by `worker` Worker and mobile-Health upload path
- **Token vault module** (shared library) — Encrypt/decrypt OAuth tokens; refresh scheduling
- **Push module** (shared library) — APNs and FCM senders
- **D1 schema** — Tables for users, connections, activities, activity_sources, dedup_pending, audit_log, outbox_events, processed_events
- **Queues** — `sync-jobs` (with DLQ), `retry-jobs` (delayed delivery), `event-bus` (domain events, with DLQ)
- **KV namespaces** — `feed-cache` (hot activity feeds)
- **R2 bucket** (`blob-store`) — FIT/TCX files, raw API payloads; path convention: `users/<user_id>/activities/<activity_id>/<artifact>`
- **Outbox Relay Worker** (Cron Trigger ~5s) — Drains `outbox_events` table to `event-bus` Queue; marks rows `processed_at` after enqueue; no deletion (audit trail)

**Modified Components:** None (greenfield).

**Removed/Deprecated Components:** None.

---

## Technical Details

### Data Model & Schema

**D1 Tables (DDL sketch):**

```sql
-- Users (authenticated identities)
CREATE TABLE users (
  id            TEXT PRIMARY KEY,           -- UUID
  email         TEXT UNIQUE,                -- nullable; auth feature owns this
  created_at    INTEGER NOT NULL,           -- epoch seconds
  updated_at    INTEGER NOT NULL
);

-- Platform connections (one per user per platform)
CREATE TABLE connections (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform            TEXT NOT NULL,        -- 'zwift' | 'strava' | 'apple_health'
  status              TEXT NOT NULL,        -- 'active' | 'requires_reauth' | 'disconnected'
  -- Encrypted token blob (AES-256-GCM, format: v1:iv:ciphertext:tag, base64)
  encrypted_tokens    TEXT,                 -- null for apple_health
  token_expires_at    INTEGER,              -- epoch seconds; null for non-expiring
  platform_user_id    TEXT,                 -- e.g., Zwift user ID
  scopes              TEXT,                 -- comma-separated
  connected_at        INTEGER NOT NULL,
  last_synced_at      INTEGER,
  last_error          TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  UNIQUE (user_id, platform)
);
CREATE INDEX idx_connections_status ON connections(status, platform);

-- Canonical activities
CREATE TABLE activities (
  id                  TEXT PRIMARY KEY,     -- UUID
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                TEXT NOT NULL,        -- 'running' | 'cycling' | 'swimming' | 'hiking' | 'walking' | 'other'
  started_at          INTEGER NOT NULL,
  ended_at            INTEGER NOT NULL,
  duration_s          INTEGER NOT NULL,
  distance_m          REAL,
  calories_kcal       REAL,
  avg_heart_rate      INTEGER,
  primary_source      TEXT NOT NULL,        -- 'zwift' | 'strava' | 'apple_health'
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX idx_activities_user_started ON activities(user_id, started_at DESC);

-- Source records (lossless raw payloads; many per activity)
CREATE TABLE activity_sources (
  id                    TEXT PRIMARY KEY,
  activity_id           TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  source                TEXT NOT NULL,
  source_activity_id    TEXT NOT NULL,
  raw_payload_path      TEXT NOT NULL,      -- R2 path to raw platform payload (e.g., users/<uid>/activities/<aid>/raw.json)
  fetched_at            INTEGER NOT NULL,
  schema_version        INTEGER NOT NULL,
  UNIQUE (source, source_activity_id)
);
CREATE INDEX idx_activity_sources_activity ON activity_sources(activity_id);

-- Dedup pending (70-85% confidence, awaiting user confirmation)
CREATE TABLE dedup_pending (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL,
  candidate_activity_id TEXT NOT NULL,      -- new activity awaiting decision
  match_activity_id     TEXT NOT NULL,      -- existing activity it might be a duplicate of
  confidence_score      REAL NOT NULL,
  scoring_breakdown     TEXT NOT NULL,      -- JSON: {type, time, duration, distance}
  created_at            INTEGER NOT NULL,
  resolved_at           INTEGER,
  resolution            TEXT                -- 'merge' | 'separate'
);

-- Audit log (token operations + external API calls; metadata only, no payloads or PII)
CREATE TABLE audit_log (
  id              TEXT PRIMARY KEY,
  user_id         TEXT,
  event_type      TEXT NOT NULL,            -- 'token_issued' | 'token_refreshed' | 'token_revoked' | 'api_call' | etc.
  platform        TEXT,
  metadata        TEXT,                     -- JSON: status code, latency, etc. NO tokens, NO activity payloads
  occurred_at     INTEGER NOT NULL
);
CREATE INDEX idx_audit_log_user_time ON audit_log(user_id, occurred_at DESC);

-- Push device registrations
CREATE TABLE push_devices (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL,            -- 'ios' | 'android'
  push_token      TEXT NOT NULL,
  active          INTEGER NOT NULL DEFAULT 1,
  registered_at   INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL,
  UNIQUE (push_token)
);

-- Transactional outbox (AD-5): domain events staged atomically with state writes
CREATE TABLE outbox_events (
  id              TEXT PRIMARY KEY,         -- UUID (becomes CloudEvents `id`)
  aggregate_type  TEXT NOT NULL,            -- 'activity' | 'connection' | 'sync_job' | 'health_upload' | 'token'
  aggregate_id    TEXT NOT NULL,            -- ID of the entity that changed
  event_type      TEXT NOT NULL,            -- CloudEvents `type`, e.g. 'activity.created'
  payload         TEXT NOT NULL,            -- JSON ≤4 KB; CloudEvents envelope + domain `data`
  created_at      INTEGER NOT NULL,         -- epoch ms
  processed_at    INTEGER                   -- epoch ms; set by outbox relay after enqueue; NULL = pending
);
CREATE INDEX idx_outbox_pending ON outbox_events(processed_at) WHERE processed_at IS NULL;

-- Consumer idempotency (AD-5): bounded-window dedup; cleanup after 24h
CREATE TABLE processed_events (
  consumer_id     TEXT NOT NULL,            -- e.g. 'dedup-engine', 'push-notifier'
  event_id        TEXT NOT NULL,            -- CloudEvents `id` (= outbox_events.id)
  processed_at    INTEGER NOT NULL,         -- epoch ms
  PRIMARY KEY (consumer_id, event_id)
);
CREATE INDEX idx_processed_events_cleanup ON processed_events(processed_at);
```

**Durable Object State (`UserSyncCoordinator`):**

```typescript
interface SyncCoordinatorState {
  userId: string;
  connections: {
    [platform: string]: {
      cursor: string | null;          // last successfully fetched cursor
      lastSyncedAt: number | null;
      inFlightJobId: string | null;   // null when no job running
      consecutiveFailures: number;
    }
  };
  schemaVersion: number;
}
```

**Schema Migrations:**
- v1: initial schema (above tables) — created in Phase 1
- Migrations managed by Drizzle ORM; SQL migration files committed to repo

**Data Privacy Considerations:**
- OAuth tokens AES-256-GCM encrypted at app layer before D1 storage
- Master key in Workers Secrets, rotatable
- Audit log MUST NOT contain tokens or activity payloads (metadata only)
- D1 column `raw_payload_path` references R2 blob path; raw payload content lives in R2 and is treated as PII — never logged
- TLS 1.3+ enforced on all endpoints

### API/Interface Changes

**New Endpoints (mobile-facing):**

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/connections/:platform/oauth/initiate` | Start OAuth flow; returns redirect URL with PKCE challenge |
| `POST` | `/api/connections/:platform/oauth/callback` | Backend handles callback (or redirect from mobile); exchanges code for tokens; stores encrypted |
| `GET` | `/api/connections` | List user's connections with status |
| `POST` | `/api/connections/:platform/disconnect` | Revoke and delete connection (with `?delete_data=true|false`) |
| `GET` | `/api/activities?since=<cursor>&limit=<n>` | Paginated incremental fetch |
| `POST` | `/api/sync/trigger?platform=<p>` | Manual sync trigger for a platform |
| `POST` | `/api/health/upload` | Apple Health batch ingest (mobile-driven) |
| `GET` | `/api/dedup/pending` | List pending dedup decisions |
| `POST` | `/api/dedup/:id/resolve` | User resolves: `{decision: 'merge'|'separate'}` |
| `POST` | `/api/devices/register` | Register/update push token for current device |
| `DELETE` | `/api/devices/:id` | Unregister push token |
| `GET` | `/api/user/export` | GDPR data export (Art. 20); inline or async with polling URL |
| `DELETE` | `/api/user` | GDPR account deletion (Art. 17); soft-delete with 30-day grace |
| `GET` | `/api/status` | Public platform sync health status page (no auth) |

**Webhook Endpoints (external-facing):**

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/webhooks/strava` | Webhook subscription verification challenge |
| `POST` | `/webhooks/strava` | Strava event delivery |

**Internal Service Interfaces:**

**`PlatformAdapter` interface (TypeScript):**
```typescript
interface PlatformAdapter {
  readonly platform: 'zwift' | 'strava' | 'apple_health';
  fetchActivities(token: string, since?: string): Promise<{
    activities: Array<{
      sourceActivityId: string;
      rawPayload: object;
      canonical: CanonicalActivity;
    }>;
    nextCursor?: string;
  }>;
  refreshToken?(refreshToken: string): Promise<TokenPair>;
  validateToken?(token: string): Promise<boolean>;
  revokeToken?(token: string): Promise<void>;
}
```

**`UserSyncCoordinator` DO interface:**
```typescript
class UserSyncCoordinator {
  async beginSync(platform: string): Promise<{ jobId: string } | { error: 'already_in_flight' }>;
  async completeSync(jobId: string, result: SyncResult): Promise<void>;
  async failSync(jobId: string, error: SyncError): Promise<void>;
  async getCursor(platform: string): Promise<string | null>;
  async listPendingDedup(): Promise<DedupPending[]>;
  async registerPushToken(deviceId: string, token: string): Promise<void>;
}
```

### Integration Points

**External Services:**
- **Zwift API** — OAuth 2.0 + REST; rate limit ~600 req/15min per app; access tokens expire after 6 hours
- **Strava API** — OAuth 2.0 + Webhooks; rate limit 600/15min, 30k/day per app; tokens expire after 6 hours
- **APNs** — HTTP/2 push API; auth via JWT (ES256) signed with team key
- **FCM** — HTTP v1 API; auth via OAuth2 service account
- **Cloudflare** (implicit) — at-rest encryption for D1, KV, DO storage (platform-managed)

**Internal Dependencies (minimum versions, May 2026):**
- `sst` ^4.12 — IaC framework (Ion engine, Pulumi-based)
- `hono` ^4.12 — HTTP framework
- `drizzle-orm` ^0.45 + `drizzle-kit` ^0.30 — ORM + migrations (D1 driver: `drizzle-orm/d1`)
- `zod` ^4 — Runtime validation (note: Zod 4 API differences vs 3, e.g. `z.email()` instead of `z.string().email()`)
- `@openauthjs/openauth` ^0.4 — OpenAuth.js issuer for `auth` Worker
- `typescript` ^5.6, `vitest` ^4, `eslint` ^9 — dev tooling

**Not required (managed by SST v4):**
- `wrangler` — SST v4 talks to the Cloudflare API directly and embeds the Miniflare runtime; `sst dev` replaces `wrangler dev`, `sst deploy` replaces `wrangler deploy`. Install Wrangler **only** as an optional ad-hoc CLI (e.g., `wrangler tail`, `wrangler d1 execute`) on developer machines that need it; do not pin in `package.json`.
- `@cloudflare/workers-types` — SST generates `Resource.*` and Worker binding types from `sst.config.ts` (`sst-env.d.ts`); add only as a fallback if publishing a shared library package outside the SST app.

---

## Constitution Compliance by Principle

### 1. Data Privacy & Security
**Compliance Strategy:**
- [x] Encryption: AES-256-GCM at app layer for OAuth tokens; D1 at-rest encryption (Cloudflare); TLS 1.3+ in transit
- [x] Access Control: User isolation by `user_id` on every query; auth middleware enforces; D1 row-level checks
- [x] Audit Trail: `audit_log` table captures token ops + API calls (metadata only); retained ≥1 year
- [x] Vendor Assessment: Cloudflare SOC 2; Zwift/Strava OAuth flows comply with RFC 6749 + 7636

**Deviations:** None.

### 2. Cross-Platform Integration
**Compliance Strategy:**
- [x] Adapter Pattern: `PlatformAdapter` interface; concrete `ZwiftAdapter`, `StravaAdapter`, `AppleHealthAdapter`
- [x] Conflict Handling: Deduplication Engine with 4-factor confidence scoring; >85% auto, 70-85% user, <70% separate
- [x] Rate Limiting: Centralized in `worker` Worker; per-platform budget tracked in DO state
- [x] Error Handling: Transient (5xx, 429, timeout) → retry queue with backoff; permanent (401/403) → `requires_reauth`

**Deviations:** None.

### 3. User Experience & Simplicity
**Compliance Strategy:**
- [x] Setup Flow: OAuth flow targets <5 min; backend redirect handling minimizes mobile UI complexity
- [x] Error Messaging: API returns coded errors (e.g., `TOKEN_EXPIRED`, `RATE_LIMITED`); mobile maps to friendly text
- [x] Progressive Disclosure: Backend exposes simple endpoints; advanced/admin endpoints not in v1
- [x] Accessibility: N/A (no UI in this feature); mobile owns accessibility

**Deviations:** None.

### 4. Reliability & Uptime
**Compliance Strategy:**
- [x] Offline Support: Mobile cache + Apple Health upload retry on mobile side; backend retries on its side
- [x] Retry Logic: Cloudflare Queues with delayed delivery; backoff 5m → 15m → 30m → 1h, capped at 24h
- [x] Data Persistence: D1 + DO storage durable across all infrastructure events
- [x] Monitoring: Cloudflare Analytics + Workers Logpush → log aggregator; alerts on SLO violations
- [x] Incident Response: Runbook for OAuth provider outage, D1 write failures, queue backlog (created in Phase 8)

**Deviations:** None.

### 5. Performance & Real-Time Sync
**Compliance Strategy:**
- [x] Latency Targets: API reads P95 <500ms; writes P95 <1s; end-to-end (platform → push) P95 <5 min (Strava webhook path <60s)
- [x] Throughput: Workers + D1 scale automatically; Queues handle bursts
- [x] Caching: KV `feed-cache` for hot activity feeds; TTL 5 min
- [x] Batching: Apple Health upload batches up to 50 activities; Zwift fetch paginated 200/page
- [x] Monitoring: Cloudflare Analytics + custom metrics emitted to Logpush

**Deviations:** None.

### 6. Code Quality & Testing
**Compliance Strategy:**
- [x] Test Coverage: Vitest for units; target ≥80%
- [x] Integration Tests: `sst dev` for local emulation (SST v4 embeds the Miniflare runtime; standalone Miniflare deprecated as of 2026); mock platform APIs with MSW
- [x] E2E Tests: Staging deploys with mock platform sandbox; mobile fixture client
- [x] Code Review: GitHub PR with required review; lint + tests in CI gating
- [x] Static Analysis: ESLint + TypeScript strict mode; `tsc --noEmit` in CI
- [x] Dependency Management: Renovate or Dependabot; weekly review

**Deviations:** None.

### 7. Transparency & Communication
**Compliance Strategy:**
- [x] User Documentation: API docs (OpenAPI spec) auto-generated; mobile-facing endpoint docs
- [x] Data Handling: Privacy policy clarifies tokens stored server-side; user can revoke + delete
- [x] Known Issues: Documented in `KNOWN_ISSUES.md` per release
- [x] Release Notes: Semver tags + GitHub Releases
- [x] Status Monitoring: Cloudflare's status page + custom synthetic checks + `/api/status` health endpoint (T064)

**Deviations:** None.

---

## Implementation Breakdown

**Phase 1: SST Project Skeleton & D1 Schema**
- Initialize SST app with Cloudflare provider
- Define D1 database, KV namespaces, Queues (sync-jobs, retry-jobs, event-bus), DO bindings, R2 bucket
- Drizzle schema for all tables (including outbox_events, processed_events)
- CloudEvents envelope types + Zod schemas for domain event `data` payloads (shared package)
- Outbox helper: `publishEvent(db, event)` that inserts into outbox_events within caller's `db.batch()`
- Outbox Relay Worker (Cron ~5s): drains pending outbox rows → event-bus Queue
- Consumer idempotency helper: `withIdempotency(consumerName, eventId, handler)` using processed_events table
- Initial migration committed
- `api` Worker scaffold with Hono + auth middleware stub + `/health` endpoint
- CI: lint + type-check + unit tests on every PR
- **Deliverables:** Deployable SST app to `dev` stage; `/health` returns 200; D1 schema applied; outbox relay running; event-bus Queue provisioned; R2 bucket bound
- **Dependencies:** Cloudflare account, Apple Developer account (for APNs later), SST CLI installed (`sst@^4.12`); Wrangler optional for ad-hoc Cloudflare operations

**Phase 2: OAuth Token Vault & Adapter Interface**
- Token encryption module (`encrypt`, `decrypt`, ciphertext versioning)
- `PlatformAdapter` interface
- Mock adapter for tests
- `connections` CRUD via `api` Worker (initiate/callback/list/disconnect)
- Audit log module
- **Deliverables:** Mobile fixture can complete a stubbed OAuth flow; tokens encrypted in D1
- **Dependencies:** Phase 1 complete

**Phase 3: Zwift Adapter + Cron-Driven Polling**
- `ZwiftAdapter` concrete implementation
- `scheduler` Worker (Cron Trigger every 30 min) querying active Zwift connections
- `worker` Worker consuming `sync-jobs` queue
- `UserSyncCoordinator` DO with begin/complete/fail sync
- `retry-jobs` queue with exponential backoff consumer
- Token refresh logic
- **Deliverables:** Real Zwift activities fetched and stored; retry on transient failure
- **Dependencies:** Phase 2 complete; Zwift OAuth app credentials

**Phase 4: Strava Adapter + Webhook Ingestion**
- `StravaAdapter` concrete implementation
- `/webhooks/strava` endpoint (GET verification + POST event)
- Webhook signature validation
- Webhook subscription management (create on first user, delete on last user)
- Hourly reconcile poll for missed events
- **Deliverables:** Strava activities arrive within 60s of completion via webhook
- **Dependencies:** Phase 3 complete; Strava OAuth + webhook credentials

**Phase 5: Deduplication Engine**
- Pure function module: `score(candidate, existing)` → confidence + breakdown
- Merge logic with per-field fidelity ranking
- `dedup_pending` table writes for 70-85% scores
- `/api/dedup/pending` and `/api/dedup/:id/resolve` endpoints
- Comprehensive unit tests across confidence boundaries (84/85/86, 69/70/71)
- **Deliverables:** Multi-source activities merge correctly; pending decisions surfaced
- **Dependencies:** Phase 4 complete (need 2+ adapters to test)

**Phase 6: Push Notification Service**
- APNs sender module (JWT generation, HTTP/2 calls)
- FCM sender module (OAuth2 service account, HTTP v1)
- `/api/devices/register` and `DELETE /api/devices/:id`
- Push dispatch from `worker` Worker after successful ingest
- Inactive token detection (handle 410 from APNs, `UNREGISTERED` from FCM)
- **Deliverables:** Mobile receives silent push within 60s of ingest
- **Dependencies:** Phase 3 complete (push triggers from sync results); APNs key + FCM service account

**Phase 7: Apple Health Ingestion Endpoint**
- `POST /api/health/upload` with Zod-validated batch payload
- Per-activity dedup execution
- Push to other user devices
- `AppleHealthAdapter` (no fetch; transforms uploaded payloads to canonical form)
- **Deliverables:** Mobile fixture uploads HK batch; backend dedups and notifies other devices
- **Dependencies:** Phase 5 (dedup) + Phase 6 (push) complete

**Phase 8: Hardening, Observability, Security Review**
- Logpush configured to log aggregator
- Custom metrics: poll success rate, push delivery rate, dedup match distribution, queue depth
- Alerts: SLO violations, queue backlog > threshold, error rate spikes
- Load test: 10k simulated users at 30-min cadence sustained 1 hour
- Security review checklist completed (OWASP Top 10 mobile-backend specifics)
- Runbooks for common incidents
- Workers Secrets key rotation procedure documented
- **Deliverables:** Production-ready; SLO dashboards live; security signoff
- **Dependencies:** All previous phases

---

## Dependencies & Blockers

**Critical Path:**
Phase 1 → Phase 2 → Phase 3 → Phase 5 → Phase 8

(Phases 4, 6, 7 can run in parallel with later parts of 3/5 once their inputs are ready.)

**External Dependencies:**
- [ ] Cloudflare account with Workers Paid plan (D1, DOs, Queues require it)
- [ ] Zwift OAuth app credentials (client_id, client_secret, redirect_uri)
- [ ] Strava OAuth app credentials + webhook subscription registration
- [ ] Apple Developer account + APNs auth key (.p8) + key ID + team ID
- [ ] Firebase project + service account JSON for FCM
- [ ] Domain name for backend (e.g., `api.fithub.app`) routed to Workers
- [ ] Decision on FitHub user authentication strategy (`001-user-authentication` feature) — can be stubbed initially

**Blockers (must resolve before Phase 1):**
- [ ] Confirm Cloudflare Workers paid plan procured
- [ ] Confirm SST + Cloudflare integration patterns (currently in active development by SST team; verify support for D1, DO, Queues)

---

## Risk Management

**Risk 1: SST Cloudflare support is less mature than AWS support**
- **Likelihood:** Medium
- **Impact:** Medium — May hit gaps requiring direct Wrangler config
- **Mitigation:** Validate SST + CF setup in a spike during Phase 1; have fallback plan to use Wrangler directly if SST gaps emerge

**Risk 2: D1 size/throughput limits hit at scale**
- **Likelihood:** Low (current limits are generous for MVP scale)
- **Impact:** High if hit
- **Mitigation:** Monitor D1 metrics; design schema for partitioning (per-region D1, sharding by user_id) if needed; D1 limits are increasing over time

**Risk 3: Backend breach exposes all user OAuth tokens**
- **Likelihood:** Low
- **Impact:** Critical
- **Mitigation:** App-layer AES-256-GCM encryption + master key in Workers Secrets; audit logging for anomaly detection; key rotation procedure; principle of least privilege on Worker bindings

**Risk 4: Strava webhook reliability**
- **Likelihood:** Medium (some delivery delays/misses observed in industry)
- **Impact:** Low (latency increases, not data loss)
- **Mitigation:** Hourly reconcile poll catches missed events

**Risk 5: Cron Trigger 30-min cadence not granular enough for some users**
- **Likelihood:** Low
- **Impact:** Low
- **Mitigation:** Manual sync trigger always available; users can also force a poll by calling `/api/sync/trigger`

**Risk 6: Cloudflare Queues max retry duration insufficient**
- **Likelihood:** Low
- **Impact:** Medium
- **Mitigation:** Implement application-layer retry counter; if 24h window exhausted, mark connection `requires_reauth` and notify user

**Risk 7: APNs/FCM token rotation not handled**
- **Likelihood:** Medium
- **Impact:** Low (push fails silently; mobile foreground fetch covers)
- **Mitigation:** Mobile must re-register on token change; backend marks tokens inactive on 410/UNREGISTERED; graceful degradation to next-foreground sync

**Risk 8: Cost overrun from aggressive polling**
- **Likelihood:** Medium
- **Impact:** Medium
- **Mitigation:** Adaptive cadence (slow to 1-hour for inactive users); cost dashboards; hard ceiling on Workers invocations per user

---

## Testing & Validation Strategy

**Unit Testing (Vitest):**
- Token crypto round-trip
- Dedup scoring at boundary cases (84/85/86%, 69/70/71%)
- Per-field fidelity ranking in merge
- Retry backoff calculator
- Error classifier (transient vs permanent)
- Adapter mocks
- **Target:** ≥80% line coverage per module

**Integration Testing (`sst dev` + MSW):**
- OAuth flow end-to-end with mocked Zwift/Strava
- Webhook handler with mocked Strava event
- Sync orchestration: queue → worker → DO → D1
- Apple Health upload: validate → dedup → push trigger
- Disconnect: revoke + delete + audit
- Re-auth: invalidate token → flag connection → reconnect

**E2E Testing (Staging):**
- Real Zwift sandbox + real Strava sandbox + real APNs sandbox
- Mobile fixture connects → polls → activities arrive → push received
- Same activity from two sources → auto-merge → mobile shows merged
- Worker eviction simulation (deploy mid-sync) → in-flight jobs resume

**Security Testing:**
- OWASP Top 10 review focused on mobile-backend
- Token vault: verify no plaintext leak in logs, errors, exports
- Auth middleware: verify cross-user access blocked
- Webhook signature validation tests
- Penetration test (external, before production cutover)

**Performance Testing:**
- Load test: 10k concurrent users at 30-min cadence sustained 1 hour
- Latency profiling: P50/P95/P99 for each endpoint
- Queue throughput under burst (10x normal load)

**Manual Testing Checklist (Phase 8):**
- [ ] Token vault: inspect D1 row, confirm ciphertext format
- [ ] Workers Secrets key rotation: rotate, decrypt old + new tokens successfully
- [ ] Push delivery: iOS + Android, foreground + background
- [ ] Audit log: 10k log lines sampled, zero PII
- [ ] Disconnect: verify token revoked at platform, vault row deleted
- [ ] Re-auth flow: invalidate token at platform, observe `requires_reauth` flag

---

## Rollout & Rollback Plan

**Deployment Strategy:**
- SST stages: `dev` (per-developer) → `staging` (shared) → `production`
- Phase 1-7: deploy continuously to `dev` and `staging`
- Phase 8: production deploy gated on security review + load test pass
- Initial production: closed beta (≤100 users, manual onboarding)
- After 2-week beta with no critical issues: open to all users

**Feature Flags:**
- `ENABLE_STRAVA_WEBHOOKS` — fallback to poll-only if disabled
- `ENABLE_PUSH_NOTIFICATIONS` — fallback to mobile foreground fetch
- `DEDUP_AUTO_MERGE_THRESHOLD` — tunable confidence threshold

**Rollback Trigger:**
- Error rate > 5% sustained 10 min
- P95 latency > 2x baseline sustained 10 min
- Token decryption failures detected
- Any data corruption observed
- **Rollback method:** SST stage rollback to previous deployment (≤5 min)

**Monitoring Post-Deployment:**
- SLO dashboards: uptime, latency, error rate
- Per-platform poll success rate
- Push delivery rate
- Queue depth (alert at >1000 messages)
- D1 storage growth
- Owner: backend on-call rotation

---

## Success Criteria

**Feature is complete when:**
- [ ] All 10 acceptance criteria from spec are met
- [ ] ≥80% unit test coverage achieved
- [ ] Security review passed (no critical findings)
- [ ] Performance targets met (P95 latency, end-to-end <5 min)
- [ ] Code review approved
- [ ] OpenAPI spec published
- [ ] Runbooks for top 5 incident scenarios written
- [ ] Staging stable for 48 hours under simulated load
- [ ] Closed beta complete (≤100 users, 2 weeks, no critical issues)

---

## Resource Allocation

**Recommended Team Composition** (adjust to actual staffing):
- Backend Lead: TS + Cloudflare experience required
- Backend Engineer 2: TS + general API skills
- Security review: 1 engineer (1-2 days, Phase 8)
- DevOps/SRE: part-time (CI/CD, alerts, runbooks)

**Skills Required:**
- TypeScript (strict mode comfortable) — critical
- Cloudflare Workers + D1 + DOs + Queues — critical (or strong willingness to learn)
- SST — nice-to-have (active CF support is recent)
- OAuth 2.0 + PKCE — critical (for adapter implementations)
- APNs/FCM integration — nice-to-have (one engineer ramps up)

---

## Open Questions & Decisions

- **Q1: User authentication strategy for FitHub itself**
  - **Status:** Resolved
  - **Resolution:** OpenAuth.js via SST Auth; supports Apple, Google, email-magic-link providers; issues JWTs validated by `api` Worker middleware. Detailed in `001-user-authentication` spec.

- **Q2: Data retention specifics (when to compress/expire raw payloads)**
  - **Status:** Pending compliance review
  - **Resolution:** Default: keep canonical fields indefinitely, raw payloads compressed after 1 year; configurable per user tier; revisit before production cutover

- **Q3: Webhook subscription lifecycle (when to create/delete Strava subscriptions)**
  - **Status:** Resolved
  - **Resolution:** Create subscription on first Strava connection per environment; delete when last connection disconnects (per Strava API constraints — one subscription per app)

- **Q4: Multi-region deployment**
  - **Status:** Deferred to v2+
  - **Resolution:** Cloudflare's edge model gives us global distribution by default; explicit multi-region D1 strategy deferred

- **Q5: Workers Secrets key rotation cadence**
  - **Status:** Pending security review
  - **Resolution:** Default annual rotation; ciphertext format includes key version (`v1:...`) to support rolling rotation

- **Q6: How does mobile know when re-auth is needed?**
  - **Status:** Resolved
  - **Resolution:** `GET /api/connections` returns `status: 'requires_reauth'`; mobile polls on app open; backend can also push a re-auth notification (deferred to v1.1)

---

## Approval & Sign-Off

- [ ] Architecture Review: ______________________ Date: _______
- [ ] Security Review: _________________________ Date: _______
- [ ] Lead Engineer: ___________________________ Date: _______
- [ ] Ready to breakdown into tasks: __________ Date: _______

---

## Related Documents

- **Feature Specification:** `.specify/specs/000-backend-foundation/spec.md`
- **Architecture Overview:** `.specify/memory/architecture-overview.md`
- **Tech Stack:** `.specify/memory/tech-stack.md`
- **Constitution:** `.specify/memory/constitution.md`
- **Task Breakdown:** `tasks.md` (to be created)
- **Dependent Features:**
  - `.specify/specs/002-zwift-oauth/` — Will be revised post-this-plan
  - `.specify/specs/003-strava-oauth/` — Will be revised post-this-plan
  - `.specify/specs/004-apple-health-integration/` — Will be revised post-this-plan
