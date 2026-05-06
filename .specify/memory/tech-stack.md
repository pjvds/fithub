# FitHub Tech Stack Decisions

**Locked as of:** May 5, 2026  
**Last Amended:** May 6, 2026 (mobile postponed; web frontend (Astro) added as primary client)
**Status:** Final (blocking decisions resolved)
**Architecture Reference:** See `.specify/memory/architecture-overview.md` for the hybrid backend-driven model.

> **Pivot note (2026-05-06):** Native mobile development is **postponed**. The user-facing client for v1 is a **web app built with Astro on Cloudflare**, hosted inside the same SST project as the API. Flutter mobile decisions captured below are preserved under "Future: Mobile (Postponed)" for when native clients are revisited. Apple Health integration is postponed with mobile (HealthKit is iOS-only and has no web equivalent).

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
- Analytics pipeline (BigQuery, ClickHouse, etc.)
- Native mobile clients (postponed; see "Future: Mobile (Postponed)" below)

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
- Sign in with Apple (cross-platform via OAuth; Apple-ID web flow)
- Sign in with Google
- Email magic-link (universal fallback; no password storage)

**Deferred to v1.1+:**
- Password authentication (only if user demand emerges)
- MFA / TOTP
- Account deletion self-service flow

**Web Integration:**
- Astro frontend redirects unauthenticated users to `https://auth.fithub.app/authorize?...`
- PKCE flow returns JWT; stored in `HttpOnly`, `Secure`, `SameSite=Lax` cookie set by the auth Worker on the apex/eTLD+1 shared with the web app
- Magic-link callback handled by an Astro route or a dedicated Worker route on `auth.fithub.app/callback`

**Email Delivery:**
- Provider TBD in `005-web-frontend` (or a future auth feature spec): Resend, Postmark, or SES via worker-mailer

**Alternatives Considered:**
- **Clerk** — polished UI widgets and mature SDKs, but per-user pricing and US-hosted
- **Auth0** — mature, but expensive and adds external dependency
- **Better Auth** — modern TypeScript-first, but newer; less proven on Workers
- **Roll our own** — security risk; reinventing OAuth, recovery, MFA

---

## Web Frontend (Primary Client for v1)

**Decision:** Astro on Cloudflare (deployed via SST)

**Rationale:**
- First-class Cloudflare Pages / Workers Static Assets support; lives inside the same SST project as the API → typed `Resource.*` bindings, shared `@fithub/core` schemas, single deploy
- "Islands" architecture: ship mostly static HTML; hydrate only the interactive parts (sync trigger, charts) → small JS payload, fast TTFB
- Comfortable for both content pages (marketing/landing) and an authed dashboard, deferring framework re-decisions
- TypeScript-native; reuses Zod schemas and Drizzle types from `packages/core`

**Topology:**
- Single Astro project at `web/` (npm workspace member)
- Server routes (`web/src/pages/api/*.ts`) run as Cloudflare Workers when needed; static routes export to HTML
- Custom domain: `app.fithub.app` (web app), `auth.fithub.app` (OpenAuth Worker)
- Authenticated session: `HttpOnly` cookie issued by `auth` Worker; `api` Worker validates JWT via JWKS

**Dependencies:**
- `astro` (latest)
- `@astrojs/cloudflare` — adapter for Cloudflare deployment
- Optional islands: any framework supported by Astro (preact / vue / solid / svelte / react) — chosen at first interactive-component need
- `tailwindcss` (or comparable) — styling; final pick deferred to `005-web-frontend`

**Out of Scope (v1):**
- SSR-heavy pages with personalized server-side rendering at scale (Astro can do it; we just don't need it for MVP)
- Service-worker-based offline mode (web v1 is online-only)

---

## Future: Mobile (Postponed)

> **Status: postponed.** Mobile development resumes in a future spec (currently no number assigned). When revived, the framework decision will be **re-evaluated**, not assumed to be Flutter — Flutter Web caveats (bundle size, no HealthKit on web, plugin gaps) surfaced during the 2026-05-06 pivot suggest other options (React Native/Expo, Capacitor, native SwiftUI/Kotlin) deserve a fresh comparison.
>
> The decisions captured below reflect the May 5, 2026 plan and are retained as **historical context only**. They are NOT binding on a future mobile spec.

**Historical Decision (postponed):** Flutter (Dart)

**Original Rationale:**
- 50% faster development vs Native iOS+Android
- ~85% quality comparable to Native
- Excellent HealthKit support (`health` package, 100K+ downloads)
- Strong OAuth PKCE support via `flutter_appauth`
- Type-safe language (Dart) catches bugs early
- Shared codebase for iOS/Android

**Original Platform Channels:**
- HealthKit (iOS): Swift platform channel
- Keychain (iOS): Swift platform channel
- Keystore (Android): Kotlin platform channel

**Original Dependencies:**
- `flutter_appauth` — OAuth 2.0 with PKCE
- `health` — HealthKit queries (iOS) + Health Connect (Android, v2+)
- `sqflite` — SQLite wrapper
- `encrypted_shared_preferences` — Token storage
- `background_fetch` — Background sync scheduling

**Original Local Database:** SQLite via `sqflite` (raw SQL migrations, no ORM)

**Original Android Health Integration:** Health Connect deferred to v2

**When Mobile Resumes — Open Questions:**
- Framework: Flutter? React Native/Expo? Capacitor + the web app? Native?
- Code-share strategy with the web app (none / OpenAPI-generated client / shared TypeScript via wrapper)
- Apple Health integration approach (the only data source that strictly requires native; everything else can run in a webview/PWA)
- Offline strategy (the original Flutter plan included a local SQLite read cache)

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

## Architectural Model (Updated 2026-05-06)

**Decision:** Backend-driven; web client for v1 (mobile postponed). See `.specify/memory/architecture-overview.md`.

- **Cloud platforms (Zwift, Strava):** Backend-driven. OAuth tokens live server-side. Backend polls/receives webhooks.
- **Device-local sources (Apple Health):** **Postponed** with mobile. Web cannot access HealthKit; revisit when a native client returns.
- **Backend** is source of truth for cloud-platform data and the consolidated/deduplicated canonical store.
- **Web client** reads from the API; is stateless beyond session cookies. No local cache layer in v1 (browser HTTP cache only).
- **Push notifications** (originally APNs/FCM to mobile) are postponed; web app uses standard HTTP polling or, optionally later, server-sent events / Web Push.

This **supersedes** the earlier "local-first, no backend until v2+" and the May 5 "Flutter mobile primary" positions.

---

## Security Implications

**Token Storage (Updated):**
- ✅ **Cloud platform tokens (Zwift, Strava):** Stored server-side in D1, AES-256-GCM encrypted at application layer; master key in Cloudflare Workers Secrets. Tokens never sent to the client.
- ✅ **FitHub session tokens on web:** `HttpOnly`, `Secure`, `SameSite=Lax` cookies set by the auth Worker. Not accessible to JavaScript.
- ⏸️ **Apple Health:** Postponed with mobile (no web equivalent).

**OAuth Flows (Updated):**
- ✅ PKCE for cloud platforms (Zwift, Strava)
- ✅ OAuth flow initiated from the web app (`/connect/{platform}` redirects to `auth.fithub.app/oauth/{platform}/start`); backend exchanges code for tokens; client receives only a connection confirmation
- ✅ Standard browser redirect (no popup, no in-app webview)

**Encryption at Rest (Backend):**
- D1 storage encrypted at infrastructure layer by Cloudflare
- OAuth tokens additionally encrypted at application layer (AES-256-GCM) before D1 write — defense in depth
- Master encryption key stored in Workers Secrets, rotatable

---

## Observability & Log Aggregation

**Decision (M5, 2026-05-06):** Cloudflare Workers emit JSON-structured logs (see `packages/core/src/logging/logger.ts`). These are shipped to an external aggregator using **Cloudflare Logpush** (Workers Trace Events).

**Chosen aggregator: Better Stack (Logtail)**
- Receives structured JSON over HTTPS from Cloudflare Logpush
- 30-day hot retention for operational queries and alerting
- Aggregate metrics: poll success/fail rates, push delivery rates, dedup match rates
- Alert channels: email + webhook (Slack) on SLO violations (error rate >1% per 5 min, queue depth >1000)
- Rationale: GDPR-compliant (EU region available), generous free tier for early-stage, native structured-JSON ingest, no agent required

**Alternatives considered:**
- Datadog: too expensive for early stage
- Axiom: good fit but tighter CF integration, revisit at scale
- Self-hosted Loki: adds ops burden — rejected

---

## Deployment Pipeline

**Backend + Web (single SST app):**
- SST deploys Workers, D1, Durable Objects, Queues, Cron Triggers, KV namespaces, R2 buckets, **and the Astro web app** (Cloudflare static assets / Pages)
- R2 buckets are accessed in Workers via SST resource linking (`link: [bucket]` → `Resource.Bucket.get(path)`). This binding model takes a relative path as input, which naturally enforces the AD-5 "path-only blob references in events" convention — consumer code cannot accidentally leak a fully-qualified R2 URL into an event payload.
- Environments: `dev` (per-developer), `staging`, `production`
- Secrets managed via SST + Cloudflare Workers Secrets
- CI/CD: GitHub Actions → `sst deploy --stage <env>` (single command builds Workers + Astro)

**Mobile:** Postponed. When revived, deployment pipeline (TestFlight, Play Store) will be specified in the future mobile spec.

---

**Version:** 1.0  
**Next Review:** After Phase 1 implementation complete
