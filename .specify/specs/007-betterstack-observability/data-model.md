# Data Model: BetterStack Observability

**Feature:** feat-007-betterstack-observability  
**Date:** 2026-05-08

---

## Overview

This feature introduces no new database tables or schema migrations. It is a pure infrastructure/configuration feature.

The data flow is:

```
FitHub Workers → console.* (structured JSON) → Tail Worker → BetterStack Logs
```

All entities are external (BetterStack-managed) or existing (FitHub `Logger` output).

---

## Existing Log Schema (unchanged)

The `Logger` class in `packages/core/src/logging/logger.ts` already emits this structure:

```
LogEntry {
  ts:            string   (ISO 8601, UTC — e.g. "2026-05-08T10:00:00.000Z")
  level:         "debug" | "info" | "warn" | "error"
  event:         string   (typed event code — e.g. "activity.ingested")
  service:       string   (Worker identity — e.g. "sync-worker", "api", "auth")
  env:           string   (SST stage — e.g. "dev", "production")
  correlationId: string?  (request/job trace ID)
  userId:        string?  (FitHub user UUID — only non-PII identifier)
  connectionId:  string?  (oauth_connections.id — optional context)
  platform:      string?  (e.g. "strava", "zwift")
  code:          string?  (typed error code on error-level entries)
  [extra]:       unknown  (additional fields, redacted by Logger.redact())
}
```

**Redacted fields** (never appear in logs): `token`, `accessToken`, `refreshToken`, `authorization`, `password`, `secret`, `apiKey`, `rawJson`, `rawPayload`, `raw`, `payload`, `email`, `name`, `ip`, `ipAddress`.

---

## Tail Worker Event Shape (Cloudflare → Tail Worker)

```
TraceItem {
  scriptName:  string           (Cloudflare Worker name — e.g. "fithub-Api")
  outcome:     "ok" | "exception" | "exceededCpu" | "canceled" | "unknown"
  logs:        TraceLog[]
  exceptions:  TraceException[]
}

TraceLog {
  message:   unknown[]   (console.* arguments — [0] is our JSON string)
  level:     string      ("log" | "warn" | "error" | "debug")
  timestamp: number      (Unix milliseconds)
}
```

---

## BetterStack Log Source (external, operator-configured)

| Attribute     | Value                                    |
|---------------|------------------------------------------|
| Source type   | HTTP (NDJSON)                            |
| Ingest URL    | `https://in.logs.betterstack.com`        |
| Auth          | Bearer token (SST secret `BetterStackToken`) |
| Retention     | ≥ 30 days (BetterStack plan setting)     |
| Per-stage     | Separate source per SST stage            |

---

## BetterStack Uptime Monitors (external, created via setup script)

| Monitor         | URL                                         | Interval | Alert after |
|-----------------|---------------------------------------------|----------|-------------|
| FitHub API      | `https://api.fithub.space/api/status`       | 1 min    | 2 failures  |
| FitHub Auth     | `https://auth.fithub.space`                 | 1 min    | 2 failures  |

---

## Schema Migrations

None. This feature requires no D1 database migrations.

---

## New SST Resources

| Resource              | Type              | Purpose                                    |
|-----------------------|-------------------|--------------------------------------------|
| `TailWorker`          | `sst.cloudflare.Worker` | Receives tail events; forwards to BetterStack |
| `BetterStackToken`    | `sst.Secret`      | BetterStack HTTP source ingest token       |

---

## Data Privacy

- Log entries shipped to BetterStack contain **only** `userId` (a UUID with no PII value on its own) as the user identifier
- Email, name, IP, tokens, and raw payloads are stripped by the existing `redact()` function before `console.*` is called
- BetterStack stores log data in their managed infrastructure; review BetterStack's DPA if GDPR compliance documentation is needed
- Log retention of 30 days is within industry norms for operational logs (not personal data retention under GDPR Art. 5)
