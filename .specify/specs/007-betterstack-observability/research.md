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
2. Create one Cloudflare Logpush job as a Pulumi resource in `sst.config.ts`:
   ```
   https://in.logs.betterstack.com?header_Authorization=Bearer%20${betterStackToken.value}
   ```
   (built via `$interpolate` from the `BetterStackToken` SST Secret)

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

## Decision 3: Uptime Monitoring — DESCOPED (§4 Deviation)

**Decision:** Uptime monitoring (endpoint polling via BetterStack) was evaluated and explicitly descoped from this feature.

**Rationale:**
- Uptime monitoring requires BetterStack's Uptime product, which has no Pulumi/Cloudflare provider — setup would require a separate API script or manual UI clicks.
- The added complexity is out of proportion to the initial release scope.
- Log-based error-rate alerting (AC3) provides partial coverage; a complete Worker outage produces no logs and no alert — this gap is documented as a §4 Constitution deviation in spec.md.

**Recommendation:** Revisit uptime monitoring as a separate feature once log-based observability is validated.

---

## Decision 4: Error-Rate Alert — BetterStack Alert Policy on `level:error`

**Decision:** Create a BetterStack **Alert** policy on the log source: `level = "error"` count > 10 per 1-minute window → trigger alert.

**Rationale:**
- BetterStack Logs supports alert policies with log-query conditions.
- A count threshold of 10/min is reasonable for a low-traffic early-stage service.
- Threshold is documented and can be tuned without code changes.

---

## Decision 5: BetterStack Token Storage — SST Secret + `$interpolate`

**Decision:** Store the BetterStack ingest token as an SST Secret (`BetterStackToken`) and embed it into the Logpush job `destination_conf` URL at deploy time using `$interpolate`.

**Rationale:**
- `sst.Secret` provides Pulumi Output-based secrets — the value is never hardcoded, never committed, and never appears in plain text in `sst.config.ts`.
- `$interpolate` builds the destination URL from the secret's Pulumi Output: `$interpolate\`https://in.logs.betterstack.com?header_Authorization=Bearer%20${betterStackToken.value}\``
- Cloudflare stores the resulting URL internally within the Logpush job; only Cloudflare infra sees the token at delivery time.
- CI seeds the secret via `sst secret set BetterStackToken "$BETTER_STACK_TOKEN"` before `sst deploy`, using the GitHub Environment secret `BETTER_STACK_TOKEN`.
- No Worker env var binding is needed — Workers never touch the token; only the Pulumi-managed Logpush job does.

**Note:** An earlier research draft incorrectly stated "No SST secret needed." This was wrong. `sst.Secret("BetterStackToken")` IS used and IS required for deploy-time injection via `$interpolate`.

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
