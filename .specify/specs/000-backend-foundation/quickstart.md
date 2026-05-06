# Quickstart: 000-backend-foundation

> Developer onboarding guide for the FitHub backend.

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | ≥20 LTS | Runtime for SST + Workers |
| npm/pnpm | Latest | Package manager |
| SST CLI | v3 (Ion) | Infrastructure-as-code |
| Wrangler | ≥3.x | Cloudflare Workers CLI (installed via SST) |
| Cloudflare account | Workers Paid plan | D1, Queues, R2, Durable Objects |

## 1. Clone & Install

```bash
git clone <repo-url> fithub
cd fithub
npm install
```

## 2. Configure Cloudflare

```bash
# Authenticate Wrangler with your Cloudflare account
npx wrangler login

# Verify access
npx wrangler whoami
```

Ensure your account has the **Workers Paid** plan (required for D1, Durable Objects, Queues).

## 3. SST Dev Environment

```bash
# Start the SST dev environment (provisions all resources in a personal dev stage)
npx sst dev
```

This will:
- Create a D1 database (dev stage)
- Create KV namespaces (`feed-cache`, `AUTH_KV`)
- Create Queues (`sync-jobs`, `retry-jobs`, `event-bus`)
- Create an R2 bucket (`blob-store`)
- Bind Durable Objects (`UserSyncCoordinator`)
- Start the `api` Worker locally on `http://localhost:8787`

## 4. Verify

```bash
curl http://localhost:8787/health
# Expected: {"status":"ok","version":"0.1.0"}
```

## 5. Run Migrations

```bash
# Apply D1 schema (Drizzle ORM)
npx drizzle-kit push
```

## 6. Run Tests

```bash
npm test
```

## 7. Project Structure

```
fithub/
├── sst.config.ts              # SST infrastructure definition
├── packages/
│   ├── core/                   # Shared types, schemas, utilities
│   │   ├── src/
│   │   │   ├── events/         # CloudEvents types + Zod schemas
│   │   │   ├── adapters/       # PlatformAdapter interface
│   │   │   ├── dedup/          # Deduplication scoring functions
│   │   │   ├── crypto/         # Token encryption/decryption
│   │   │   └── outbox/         # Outbox helper (publishEvent)
│   │   └── package.json
│   └── functions/
│       ├── src/
│       │   ├── api/            # api Worker (Hono routes)
│       │   ├── scheduler/      # scheduler Worker (Cron)
│       │   ├── worker/         # worker Worker (Queue consumer)
│       │   ├── outbox-relay/   # Outbox Relay Worker (Cron ~5s)
│       │   └── auth/           # auth Worker (OpenAuth.js)
│       └── package.json
├── drizzle/                    # D1 schema + migrations
│   ├── schema.ts
│   └── migrations/
├── .specify/                   # Speckit artifacts
│   ├── memory/
│   ├── specs/
│   └── templates/
└── package.json
```

## 8. Key Commands

| Command | Purpose |
|---|---|
| `npx sst dev` | Start local dev environment |
| `npx sst deploy --stage dev` | Deploy to dev stage |
| `npm test` | Run unit tests |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript compiler (no emit) |
| `npx drizzle-kit push` | Apply D1 schema changes |
| `npx drizzle-kit generate` | Generate migration from schema diff |

## 9. Environment Variables / Secrets

Set via `npx sst secret set <name> <value>`:

| Secret | Purpose |
|---|---|
| `TOKEN_MASTER_KEY` | AES-256 key for OAuth token encryption |
| `ZWIFT_CLIENT_SECRET` | Zwift OAuth app secret |
| `STRAVA_CLIENT_SECRET` | Strava OAuth app secret |
| `APNS_PRIVATE_KEY` | Apple Push Notification auth key (.p8 content) |
| `FCM_SA_JSON` | Firebase Cloud Messaging service account JSON |
| `OPENAUTH_SIGNING_KEY` | JWT signing key for OpenAuth.js |
| `APPLE_CLIENT_SECRET` | Apple Sign-In client secret |
| `GOOGLE_CLIENT_SECRET` | Google Sign-In client secret |
| `EMAIL_PROVIDER_KEY` | Email magic link provider API key |

## 10. Event-Driven Architecture

All domain state changes flow through the **outbox pattern**:

1. Worker writes state + outbox row in one `db.batch()` call
2. Outbox Relay Worker (Cron ~5s) drains pending rows to `event-bus` Queue
3. Consumer Workers process events with idempotency checks (`processed_events` table)

Events conform to **CloudEvents v1.0** JSON format. See `packages/core/src/events/` for Zod schemas.

Large payloads (FIT files, raw API responses) are stored in **R2** at:
```
users/<user_id>/activities/<activity_id>/<artifact>
```
Events reference blobs by **path only** — never URLs or bucket names.
