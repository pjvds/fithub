# Tail Worker Contract

**Feature:** feat-007-betterstack-observability  
**Date:** 2026-05-08

---

## Overview

The Tail Worker is an internal Cloudflare Worker that receives `TraceItem[]` payloads from all other FitHub Workers and forwards structured log entries to BetterStack Logs.

This is not a public API — there are no external HTTP endpoints. The contract is between:
- **Producer**: Any FitHub Worker (Api, Auth, SyncWorker, OutboxRelay, Scheduler) via Cloudflare's tail mechanism
- **Consumer**: BetterStack Logs HTTP source

---

## Tail Worker Handler Contract

```typescript
// Cloudflare Tail Worker entry point
export default {
  async tail(events: TraceItem[], env: TailEnv): Promise<void>
}

interface TailEnv {
  BETTER_STACK_TOKEN: string; // SST secret — BetterStack HTTP source ingest token
}
```

**Input**: `TraceItem[]` — delivered by Cloudflare after each producing Worker invocation  
**Output**: NDJSON POST to `https://in.logs.betterstack.com`  
**Side effects**: None beyond HTTP egress to BetterStack  
**Error handling**: Silent failure (swallow BetterStack errors) — log shipping must never crash the Tail Worker in a way that affects the producing Worker

---

## BetterStack Ingest Request

```
POST https://in.logs.betterstack.com
Authorization: Bearer {BETTER_STACK_TOKEN}
Content-Type: application/x-ndjson

// One JSON line per log entry:
{
  "dt":            "2026-05-08T10:00:00.000Z",  // BetterStack's timestamp field
  "level":         "info",
  "message":       "activity.ingested",          // BetterStack message field = event code
  "worker":        "SyncWorker",                 // injected by Tail Worker from TraceItem.scriptName
  // ...all other fields from the original Logger JSON entry (service, env, userId, etc.)
}
```

**Field mapping from Logger output → BetterStack:**

| Logger field  | BetterStack field | Notes                                      |
|---------------|-------------------|--------------------------------------------|
| `ts`          | `dt`              | Renamed — BetterStack uses `dt` for timestamp |
| `event`       | `message`         | BetterStack uses `message` as primary label |
| `level`       | `level`           | Pass through unchanged                     |
| `service`     | `service`         | Pass through unchanged                     |
| `env`         | `env`             | Pass through unchanged                     |
| `correlationId` | `correlationId` | Pass through unchanged                     |
| `userId`      | `userId`          | Pass through unchanged                     |
| *(injected)*  | `worker`          | `TraceItem.scriptName` — Cloudflare Worker name |
| all others    | pass through      | Extra fields forwarded as-is               |

---

## BetterStack Uptime Monitor API (setup script)

The `scripts/setup-betterstack.ts` script calls the BetterStack API once per environment to create uptime monitors.

```
POST https://api.betterstack.com/api/v2/monitors
Authorization: Bearer {BETTER_STACK_UPTIME_TOKEN}
Content-Type: application/json

{
  "monitor_type": "status",
  "url": "https://api.fithub.space/api/status",
  "pronounceable_name": "FitHub API",
  "check_frequency": 60,
  "request_timeout": 15,
  "expected_status_codes": [200],
  "confirmation_period": 120
}
```

**Monitors created:**
1. `FitHub API` — `GET https://api.fithub.space/api/status` (expects 200)
2. `FitHub Auth` — `GET https://auth.fithub.space` (expects 200)

`confirmation_period: 120` = 2 consecutive failures before alerting (reduces false positives).

---

## No Public API Changes

This feature does not add, modify, or remove any FitHub public API endpoints.  
The existing `GET /api/status` endpoint (T064) is consumed by BetterStack Uptime externally — no changes to that endpoint.
