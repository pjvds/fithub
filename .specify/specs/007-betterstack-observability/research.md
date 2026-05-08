# Research: BetterStack Observability

**Feature:** feat-007-betterstack-observability  
**Date:** 2026-05-08

---

## Decision 1: Log Shipping Mechanism — Tail Worker (not Logpush)

**Decision:** Use a Cloudflare **Tail Worker** to forward logs to BetterStack.

**Rationale:**
- Cloudflare Logpush HTTP destinations require a Business or Enterprise plan. FitHub runs on the Workers free/paid tier — Logpush is not available without upgrading.
- Tail Workers are available on all plans. A Tail Worker is a normal Cloudflare Worker that declares itself a `tail_consumer` for other Workers; Cloudflare pushes `TraceItem[]` arrays to it after each invocation.
- A Tail Worker is ~20 lines of code: receive `TraceItem[]`, flatten log entries, POST NDJSON to BetterStack's HTTP source endpoint.
- Zero impact on the request hot path — Tail Workers run asynchronously after the producing Worker finishes.

**Alternatives Considered:**
- **Cloudflare Logpush**: Requires Business+ plan. Rejected (cost).
- **In-Worker HTTP fetch to BetterStack**: Logging directly from each Worker adds latency and couples every Worker to BetterStack availability. Rejected.
- **Axiom**: Functionally equivalent. BetterStack preferred because account already exists.

---

## Decision 2: BetterStack Source Format — HTTP Source (NDJSON)

**Decision:** Create a BetterStack **HTTP source** with NDJSON ingestion. The Tail Worker batches log entries per invocation and POSTs them as NDJSON (`Content-Type: application/x-ndjson`) to `https://in.logs.betterstack.com`.

**Rationale:**
- BetterStack's HTTP source accepts NDJSON and maps JSON fields automatically — `event`, `level`, `service`, `userId`, `correlationId` all become queryable fields without any schema configuration.
- The existing `Logger` emits exactly this format already. No transformation needed.
- Per-stage sources (`fithub-dev`, `fithub-prod`) keep staging noise isolated from production alerts.

**Alternatives Considered:**
- **Syslog source**: Requires log format transformation. Rejected.
- **Datadog/Axiom**: Functional alternatives but we have BetterStack account. Rejected.

---

## Decision 3: Uptime Monitoring — BetterStack API + Script

**Decision:** Create uptime monitors via the **BetterStack Uptime REST API** using a one-time setup script (`scripts/setup-betterstack.ts`). This makes the configuration reproducible and code-reviewable.

**Rationale:**
- Manual UI clicks are not reproducible. A setup script documents intent and can be re-run for new environments.
- BetterStack's Uptime API (`api.betterstack.com/api/v2/monitors`) supports CRUD for monitors with full configuration.
- The script runs once per environment and is idempotent (check-before-create).

**Monitors to create:**
1. `FitHub API` — `GET https://api.fithub.space/api/status` every 1 min
2. `FitHub Auth` — `GET https://auth.fithub.space` every 1 min (expects HTTP 200)

**Alert policy:** 2 consecutive failures → page (reduces false positives from transient Cloudflare edge blips).

---

## Decision 4: Error-Rate Alert — BetterStack Alert Policy on `level:error`

**Decision:** Create a BetterStack **Alert** policy on the log source: `level = "error"` count > 10 per 1-minute window → trigger alert.

**Rationale:**
- BetterStack Logs supports alert policies with log-query conditions.
- A count threshold of 10/min is reasonable for a low-traffic early-stage service; 1 error per minute in normal operation is likely noise, 10+ indicates a real problem.
- Threshold is documented and can be tuned without code changes.

---

## Decision 5: SST Secret for BetterStack Source Token

**Decision:** Store the BetterStack source ingest token as `sst secret set BetterStackToken <value>`. The Tail Worker receives it as a bound secret.

**Rationale:**
- Consistent with existing SST secret pattern (`TOKEN_MASTER_KEY`, `STRAVA_CLIENT_SECRET`, etc.).
- Not committed to the repository.
- Per-stage: `BetterStackToken` is set separately for dev and prod.

---

## Tail Worker: TraceItem Shape (Cloudflare)

Cloudflare delivers `TraceItem[]` to Tail Workers. Relevant fields:

```typescript
interface TraceItem {
  scriptName: string;           // Worker name (e.g. "Api", "SyncWorker")
  outcome: "ok" | "exception" | "exceededCpu" | "canceled" | "unknown";
  logs: TraceLog[];             // console.* calls
  exceptions: TraceException[]; // uncaught exceptions
}

interface TraceLog {
  message: unknown[];           // arguments passed to console.log/warn/error
  level: string;                // "log", "warn", "error", "debug"
  timestamp: number;            // milliseconds since epoch
}
```

The Tail Worker extracts `logs[].message[0]` (already a JSON string from our `Logger`), parses it, adds `scriptName` as `worker` field, then POSTs to BetterStack.

---

## Cloudflare Tail Worker Binding in SST Ion

SST Ion uses the Cloudflare Pulumi provider. To bind a Tail Worker to existing Workers, use `transform.worker` to inject `tailConsumers`:

```typescript
const tailWorker = new sst.cloudflare.Worker("TailWorker", {
  handler: "packages/functions/src/tail/index.ts",
  link: [betterStackToken],
});

// On each producing Worker:
const api = new sst.cloudflare.Worker("Api", {
  // ...existing config...
  transform: {
    worker: (args) => {
      args.tailConsumers = [{ service: tailWorker.name }];
    },
  },
});
```

`tailConsumers` is a native Cloudflare Pulumi provider property on `cloudflare.WorkerScript`.

---

## BetterStack HTTP Source Ingest Format

```
POST https://in.logs.betterstack.com
Authorization: Bearer <source-token>
Content-Type: application/x-ndjson

{"ts":"2026-05-08T10:00:00.000Z","level":"info","event":"activity.ingested","service":"sync-worker","userId":"abc123"}
{"ts":"2026-05-08T10:00:01.000Z","level":"error","event":"sync.job.failed","service":"sync-worker","userId":"abc123","code":"STRAVA_TOKEN_EXPIRED"}
```

Fields map directly to BetterStack queryable attributes — no schema configuration required.
