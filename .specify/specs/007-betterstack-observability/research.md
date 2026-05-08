# Research: BetterStack Observability

**Feature:** feat-007-betterstack-observability  
**Date:** 2026-05-08

---

## Decision 1: Log Shipping Mechanism — Cloudflare Logpush (not Tail Worker)

**Decision:** Use **Cloudflare Logpush** (Workers Trace Events dataset) to forward logs to BetterStack.

**Rationale:**
- Cloudflare Logpush for Workers Trace Events is available on the **Workers Paid plan** — no Business or Enterprise tier required.
- Zero custom code: Cloudflare natively delivers structured Worker invocation traces (including `console.*` output) to any HTTPS destination.
- The BetterStack HTTPS ingest endpoint is a standard Logpush destination — configure once, works for all Workers.
- Workers must have `logpush: true` set in script metadata (one boolean per Worker).
- No Tail Worker needed. Tail Workers are only preferable when custom log transformation is required at ingestion time.

**Implementation:**
1. Set `logpush: true` on each Worker script via `transform.worker: { logpush: true }` in SST Ion.
2. Create one Cloudflare Logpush job targeting BetterStack's HTTPS endpoint:
   ```
   https://in.logs.betterstack.com?header_Authorization=Bearer%20<TOKEN>
   ```
3. Run the one-time setup script `scripts/setup-betterstack.ts`.

**Alternatives Considered:**
- **Tail Worker**: Evaluated first, then rejected after consulting BetterStack's official Cloudflare integration docs. The BetterStack docs explicitly recommend Logpush. Tail Workers add unnecessary custom code and maintenance overhead.
- **In-Worker HTTP fetch to BetterStack**: Adds latency and couples each Worker to BetterStack availability. Rejected.
- **Axiom**: Functionally equivalent. BetterStack preferred because account already exists.

**Note:** An initial incorrect research entry stated Logpush required Business/Enterprise plan. This was wrong. Workers Paid plan includes Logpush for `workers_trace_events`. This has been verified against BetterStack docs at https://betterstack.com/docs/logs/cloudflare/logpush/ and Cloudflare's Logpush HTTPS destination documentation.

---

## Decision 2: BetterStack Source Format — HTTPS Logpush (JSON)

**Decision:** Create a BetterStack **HTTP source** and configure Cloudflare Logpush to deliver `workers_trace_events` to it.

**Rationale:**
- BetterStack's HTTP source accepts JSON from Logpush automatically — `event`, `level`, `service`, `userId`, `correlationId` become queryable fields without schema configuration.
- The existing `Logger` emits structured JSON via `console.*` calls, which Cloudflare captures in `TraceItem.logs[].message`.
- Per-stage sources (`fithub-dev`, `fithub-prod`) keep staging noise isolated from production alerts.

**Alternatives Considered:**
- **Syslog source**: Requires log format transformation. Rejected.
- **Datadog/Axiom**: Functional alternatives but we have BetterStack account. Rejected.

---

## Decision 3: Uptime Monitoring — BetterStack API + Script

**Decision:** Create uptime monitors via the **BetterStack Uptime REST API** using a one-time setup script (`scripts/setup-betterstack.ts`). This makes the configuration reproducible and code-reviewable.

**Rationale:**
- Manual UI clicks are not reproducible. A setup script documents intent and can be re-run for new environments.
- BetterStack's Uptime API (`uptime.betterstack.com/api/v2/monitors`) supports CRUD for monitors.
- The script runs once per environment and is idempotent (check-before-create).

**Monitors to create:**
1. `FitHub API` — `GET https://api.fithub.space/health` every 3 min
2. `FitHub Auth` — `GET https://auth.fithub.space/health` every 3 min

**Alert policy:** 2 consecutive failures → page (reduces false positives from transient Cloudflare edge blips).

---

## Decision 4: Error-Rate Alert — BetterStack Alert Policy on `level:error`

**Decision:** Create a BetterStack **Alert** policy on the log source: `level = "error"` count > 10 per 1-minute window → trigger alert.

**Rationale:**
- BetterStack Logs supports alert policies with log-query conditions.
- A count threshold of 10/min is reasonable for a low-traffic early-stage service.
- Threshold is documented and can be tuned without code changes.

---

## Decision 5: BetterStack Token Storage

**Decision:** The BetterStack ingest token is embedded in the Logpush job `destination_conf` URL, stored inside Cloudflare's Logpush configuration — not in Workers env vars, not as an SST secret. The token is only needed at setup-script runtime and is supplied via the `BETTER_STACK_TOKEN` environment variable.

**Rationale:**
- Logpush jobs authenticate via the `destination_conf` URL using `header_Authorization=Bearer%20TOKEN` query parameter syntax. Cloudflare stores this internally.
- No SST secret needed. No Worker binding needed. Zero runtime overhead.
- The GitHub Environment secret `BETTER_STACK_TOKEN` is used only when running `scripts/setup-betterstack.ts` manually — it is not needed by the deploy pipeline.

---

## Cloudflare Logpush: Enabling on a Worker (SST Ion)

Add `logpush: true` to the Worker's `transform.worker` in `sst.config.ts`:

```typescript
const api = new sst.cloudflare.Worker("Api", {
  handler: "packages/functions/src/api/index.ts",
  // ...
  transform: {
    worker: {
      logpush: true,
      // other transform props...
    },
  },
});
```

This sets `logpush: true` on the underlying `cloudflare.WorkerScript` Pulumi resource, which enables Cloudflare to include this Worker's traces in Logpush jobs with `dataset: "workers_trace_events"`.

---

## Cloudflare Logpush Job API

```
POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/logpush/jobs
Authorization: Bearer <CF_API_TOKEN>
Content-Type: application/json

{
  "name": "fithub-workers-betterstack",
  "dataset": "workers_trace_events",
  "destination_conf": "https://in.logs.betterstack.com?header_Authorization=Bearer%20<BETTER_STACK_TOKEN>",
  "enabled": true
}
```

The `header_*` query parameter syntax causes Cloudflare to inject `Authorization: Bearer <TOKEN>` as an HTTP header when delivering logs to BetterStack.

---

## BetterStack Log Entry Format

Cloudflare delivers `console.*` output as the log body. With FitHub's structured logger, each entry arrives as:

```json
{"ts":"2026-05-08T10:00:00.000Z","level":"info","event":"activity.ingested","service":"sync-worker","userId":"abc123","correlationId":"req-xyz"}
```

Fields map directly to BetterStack queryable attributes — no schema configuration required.
