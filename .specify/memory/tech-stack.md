# FitHub Tech Stack Decisions

**Locked as of:** May 5, 2026  
**Status:** Final (blocking decisions resolved)
**Architecture Reference:** See `.specify/memory/architecture-overview.md` for the hybrid backend-driven model.

---

## Backend (Cloud Platforms — Zwift, Strava)

**Decision:** TypeScript + SST + Cloudflare

**Rationale:**
- Hybrid architecture (per AD-1) requires a backend to hold OAuth tokens and orchestrate sync for cloud platforms
- TypeScript shares a language with potential web client; strong typing for canonical activity model
- SST provides IaC, dev experience, and deployment workflows on top of Cloudflare primitives
- Cloudflare's edge platform offers low cost, generous free tier, global low-latency, scales to zero
- Native primitives map cleanly to FitHub's needs (see component mapping below)

**Component Mapping:**

| Concern | Cloudflare Primitive | Why |
|---------|----------------------|-----|
| API gateway, webhook handlers | **Workers** | Edge-distributed, scale-to-zero, no cold-start tax for typical loads |
| Canonical activity store | **D1** (SQLite at edge) | Relational fits the schema; low latency from Workers; integrates natively |
| Per-user sync coordination state | **Durable Objects** | Single-writer per user, persistent state, ideal for sync orchestrator |
| 30-min Zwift polls | **Cron Triggers** | Native scheduled invocation; no extra scheduler infra |
| Persistent retry queue | **Queues** | Survives all restarts (fully managed), delays + DLQ supported |
| Hot read caches (activity feeds, dedup recent-window lookups) | **Workers KV** | Eventually-consistent cache acceptable here |
| Service secrets (master keys, API creds) | **Workers Secrets** | Native secret management |
| User OAuth token encryption | **AES-256-GCM at app layer** + master key in Secrets | Defense in depth: app-layer encryption before D1 storage |

**Dependencies:**
- `sst` — IaC, dev workflow, multi-environment deploys
- `hono` (or similar) — Lightweight HTTP framework for Workers
- `@cloudflare/workers-types` — Type definitions
- `zod` — Runtime schema validation for API payloads
- `drizzle-orm` (or raw SQL) — D1 query layer; raw SQL acceptable for performance

**Out of Scope (v2+):**
- Multi-region replication beyond Cloudflare's defaults
- Web client / dashboard
- Analytics pipeline (BigQuery, ClickHouse, etc.)

---

## User Authentication (FitHub Identity)

**Decision:** OpenAuth.js (SST Auth) — self-hosted on Cloudflare Workers

**Rationale:**
- First-class Cloudflare Workers support (built-in Workers KV adapter)
- Made by the SST team — native to our stack, single SST deploy
- Self-hosted: zero per-user cost, full data sovereignty (Constitution §1)
- Standards-based OAuth 2.0 + PKCE; works with `flutter_appauth` (already a dep)
- TypeScript-native; types shareable with `api` Worker for JWT claims
- Open source — no vendor lock-in

**Topology:**
- Deployed as 4th logical Worker (`auth.fithub.app`) in the same SST app as `api`, `scheduler`, `worker`
- Workers KV namespace `AUTH_KV` for refresh tokens, OTP codes, auth codes
- D1 `users` table as canonical user store (same database as activities)
- JWT (RS256) issued by `auth`, validated by `api` via JWKS endpoint

**Providers (MVP):**
- Sign in with Apple (mandatory on iOS App Store when offering other social logins)
- Sign in with Google (Android-friendly; cross-platform)
- Email magic-link (universal fallback; no password storage)

**Deferred to v1.1+:**
- Password authentication (only if user demand emerges)
- MFA / TOTP
- Account deletion self-service flow

**Mobile Integration:**
- `flutter_appauth` opens `https://auth.fithub.app/authorize?...` in `ASWebAuthenticationSession` (iOS) / Custom Tabs (Android)
- PKCE flow returns JWT; stored in iOS Keychain / Android Keystore
- `app_links` package handles magic-link deep links (`https://app.fithub.app/auth/callback?code=...`)

**Email Delivery:**
- Provider TBD in `001-user-authentication` spec (Resend, Postmark, or SES via worker-mailer)

**Alternatives Considered:**
- **Clerk** — best mobile DX (RN/iOS/Android SDKs mature; Flutter SDK newer/uncertain), polished widgets, but per-user pricing and US-hosted
- **Auth0** — mature `auth0_flutter` SDK, but expensive and adds external dependency
- **Better Auth** — modern TypeScript-first, but newer; less proven on Workers
- **Roll our own** — security risk; reinventing OAuth, recovery, MFA

---

## Mobile Framework

**Decision:** Flutter (Dart)

**Rationale:**
- 50% faster development vs Native iOS+Android
- ~85% quality comparable to Native
- Excellent HealthKit support (`health` package, 100K+ downloads)
- Strong OAuth PKCE support via `flutter_appauth`
- Type-safe language (Dart) catches bugs early
- Shared codebase for iOS/Android

**Platform Channels:**
- HealthKit (iOS): Swift platform channel
- Keychain (iOS): Swift platform channel
- Keystore (Android): Kotlin platform channel

**Dependencies:**
- `flutter_appauth` — OAuth 2.0 with PKCE
- `health` — HealthKit queries (iOS) + Health Connect (Android, v2+)
- `sqflite` — SQLite wrapper
- `encrypted_shared_preferences` — Token storage
- `background_fetch` — Background sync scheduling

---

## Local Database

**Decision:** SQLite via `sqflite`

**Rationale:**
- Industry standard (no lock-in risk)
- Excellent query patterns for deduplication algorithm
- Simple migration strategy (raw SQL scripts)
- Native support on iOS and Android
- 50MB+ datasets performant (indexed queries)

**Schema Locations:**
- `lib/data/database/schemas/` — SQL migration files
- `lib/data/models/` — Dart entity classes
- `lib/data/repositories/` — Query layer (repository pattern)

**Migration Strategy:**
- Version-based migrations (v1.sql, v2.sql, ...)
- No ORM (raw queries for performance)
- Backup/export via sqflite API

---

## Android Health Integration

**Decision:** Skip Android Health Connect for MVP

**Rationale:**
- Launch iOS first (Zwift/Strava/HealthKit)
- Android Health Connect adds 3-4 weeks scope (parallel implementation)
- iOS HealthKit covers immediate dogfooding needs
- Android Health Connect planned for v2 (post-launch)

**Future (v2+):**
- Android Health Connect integration
- Parallel schema to HealthKit (different permission model)
- Reuse OAuth Manager and Normalizer for Zwift/Strava on Android

---

## Event Bus & Blob Storage (Added 2026-05-06)

**Decision:** All domain state changes propagate as events via the **D1 transactional outbox pattern → Cloudflare Queues**. See `architecture-overview.md` AD-5 for the full architectural decision.

| Concern | Choice | Notes |
|---|---|---|
| **Event bus** | **Cloudflare Queues** | First-party, retry + DLQ + batching; binds natively to Workers. |
| **Event schema** | **CloudEvents v1.0 JSON** | CNCF standard wire format; Zod schemas validate `data` payload per type at publish + consume. |
| **DB↔bus consistency** | **Outbox pattern in D1** | Cloudflare's officially documented best practice (`developers.cloudflare.com/d1/use-cases/processing-events/`). Atomic `db.batch([...])` writes state row + outbox row in one SQLite transaction; relay Worker drains outbox to Queues. Processed rows marked with `processed_at`, retained (not deleted) as audit/replay trail; automated sweep deferred to post-MVP. |
| **Blob storage** | **Cloudflare R2** | Stores FIT/TCX files and raw platform API payloads. Free egress to Workers. |
| **Per-entity ordering** | **Durable Objects** | One DO per user; serializes dedup and other ordered operations. |
| **Workflows** | Deferred | Cloudflare Workflows considered for multi-step sagas but not adopted in MVP (API still evolving). |

**Event schema standard:** All events conform to the **CloudEvents v1.0 JSON specification** (CNCF standard). Required attributes: `specversion` (`"1.0"`), `id` (UUID), `source` (e.g., `fithub/sync-worker`), `type` (dot-namespaced, see Naming below), `time` (ISO 8601). Domain-specific payload lives in `data`. **Zod schemas** validate the `data` payload per event type at both publish and consume boundaries. Rationale: vendor-neutral wire format; enables webhook-out without envelope rewriting; observability tooling understands the format natively.

**Event payload contract:**
- Events are small JSON (target ≤4 KB including CloudEvents envelope).
- Large blobs live in R2; events reference them by **storage path only** (e.g., `users/<uid>/activities/<aid>/raw.fit`).
- Events MUST NOT contain fully-qualified R2 URLs, bucket names, or provider-specific URIs. This keeps event schemas storage-agnostic so the storage backend can be swapped without touching event consumers.

**Naming:** Events use past-tense, dot-namespaced names in the CloudEvents `type` attribute: `activity.ingested`, `activity.merged`, `activity.created`, `connection.created`, `connection.revoked`, `health_upload.received`, `sync_job.completed`, `sync_job.failed`.

**Delivery & idempotency:**
- Cloudflare Queues delivers **at-least-once**; consumers dedup using the CloudEvents `id` as idempotency key.
- Each consumer tracks processed IDs in a `processed_events` D1 table `(consumer_id, event_id, processed_at)`.
- **Bounded-window cleanup:** daily cron deletes rows older than 24h. Safe because Queues' max retry window (12h) < cleanup window (24h) — a processed event's dedup row always outlives the retry window.
- **Extended outage (>12h):** undelivered messages move to the DLQ, not lost. DLQ replay re-introduces them with original `event_id`; if dedup row was cleaned up, the event was never processed — correct to process now.

**Scope rule:** Domain events only — emit when another service or the user must react. Internal Worker mechanics are not events. See AD-5 event catalogue in `architecture-overview.md` for the canonical list.

---

## Architectural Model (Updated 2026-05-05)

**Decision:** Hybrid backend-driven (see `.specify/memory/architecture-overview.md`)

- **Cloud platforms (Zwift, Strava):** Backend-driven. OAuth tokens live server-side. Backend polls/receives webhooks; pushes to mobile via APNs/FCM.
- **Device-local sources (Apple Health):** Mobile-driven. HealthKit data stays on device; mobile pushes deltas to backend via REST.
- **Backend** is source of truth for cloud-platform data and the consolidated/deduplicated canonical store.
- **Mobile SQLite** is a read-optimized projection of backend data, plus a write-buffer for Apple Health pre-upload.

This **supersedes** the earlier "local-first, no backend until v2+" position.

---

## Security Implications

**Token Storage (Updated):**
- ✅ **Cloud platform tokens (Zwift, Strava):** Stored server-side in D1, AES-256-GCM encrypted at application layer; master key in Cloudflare Workers Secrets. Tokens never sent to mobile.
- ✅ **FitHub session tokens on mobile:** Stored in iOS Keychain / Android Keystore (system-managed). These are FitHub's own auth tokens, not platform OAuth tokens.
- ✅ **Apple Health:** No tokens needed (permission-based local SDK).

**OAuth Flows (Updated):**
- ✅ PKCE for cloud platforms (Zwift, Strava)
- ✅ OAuth flow initiated on mobile, redirect handled by backend; backend exchanges code for tokens; mobile receives only a connection confirmation
- ✅ System OAuth dialog or in-app browser (no custom WebView, avoids interception)

**Encryption at Rest (Backend):**
- D1 storage encrypted at infrastructure layer by Cloudflare
- OAuth tokens additionally encrypted at application layer (AES-256-GCM) before D1 write — defense in depth
- Master encryption key stored in Workers Secrets, rotatable

---

## Deployment Pipeline

**Backend:**
- SST deploys Workers, D1, Durable Objects, Queues, Cron Triggers, KV namespaces, R2 buckets
- R2 buckets are accessed in Workers via SST resource linking (`link: [bucket]` → `Resource.Bucket.get(path)`). This binding model takes a relative path as input, which naturally enforces the AD-5 "path-only blob references in events" convention — consumer code cannot accidentally leak a fully-qualified R2 URL into an event payload.
- Environments: `dev` (per-developer), `staging`, `production`
- Secrets managed via SST + Cloudflare Workers Secrets
- CI/CD: GitHub Actions → `sst deploy --stage <env>`

**Mobile (Phase 1 MVP):**
- iOS TestFlight beta
- Android Google Play internal testing

**Mobile (Phase 2 v1.0):**
- iOS App Store
- Android Google Play

---

**Version:** 1.0  
**Next Review:** After Phase 1 implementation complete
