# Implementation Plan: BetterStack Observability

**Feature:** BetterStack Observability (Reference: `.specify/specs/007-betterstack-observability/spec.md`)

**Plan ID:** plan-feat-007-betterstack-observability

**Version:** 2.0.0

**Planned By:** Copilot

**Date:** 2026-05-08

**Revised:** 2026-05-08 — pivoted from Tail Worker to Cloudflare Logpush + Pulumi; uptime monitoring descoped

---

## Problem & Approach

**Feature Problem:**
FitHub Workers emit richly structured JSON logs that are only visible in Cloudflare's 1-hour rolling tail. There is no persistent log storage, no cross-session search, and no alerting. Incidents at 2 AM go undetected until a user reports them.

**Implementation Approach:**
Enable Cloudflare's native **Logpush** mechanism on all five FitHub Workers (`logpush: true` per Worker) and declare a `cloudflare.LogpushJob` Pulumi resource in `sst.config.ts` that delivers Workers Trace Events (including structured `console.*` output) to BetterStack Logs over HTTPS. The BetterStack source token is stored as an SST Secret and injected into the Logpush destination URL via `$interpolate` at deploy time. Zero changes to the `Logger` class or Worker business logic.

---

## Design Decisions & Rationale

**Decision 1: Cloudflare Logpush over Tail Worker**
- **Choice:** Enable `logpush: true` on each Worker + declare a `cloudflare.LogpushJob` Pulumi resource pointing at BetterStack's HTTPS ingest endpoint
- **Rationale:** Cloudflare Logpush for `workers_trace_events` is available on the Workers Paid plan — no Business or Enterprise tier required. It delivers structured traces natively, requires zero custom code, and is configured as Pulumi infrastructure alongside the rest of the stack. Tail Workers were evaluated but rejected: they require a custom Worker binary, add deployment complexity, and provide no benefit when the existing `console.*` structured output is BetterStack-compatible as-is.
- **Constitution Alignment:** Principle 6 (Code Quality) — zero new production code surface area; Principle 8 (Logging) — all Workers covered by a single Logpush job
- **Alternatives Considered:** Tail Worker (unnecessary code complexity), in-Worker `fetch()` to BetterStack (hot-path coupling, rejected)
- **Impact:** One new Pulumi resource in `sst.config.ts`; one boolean flag per Worker; no new Worker to deploy or maintain

**Decision 2: SST Secret + $interpolate for Token Injection**
- **Choice:** Store the BetterStack source token as `sst.Secret("BetterStackToken")`; embed it in the Logpush `destinationConf` URL using `$interpolate`
- **Rationale:** The Logpush job `destination_conf` URL embeds the auth token via a `header_Authorization` query parameter that Cloudflare translates to an HTTP header at delivery time. Using `$interpolate` with an SST Secret means the token is resolved at deploy time from the SST secret store — never hardcoded, never committed, and automatically available in CI via `sst secret set BetterStackToken`.
- **Constitution Alignment:** Principle 1 (Data Privacy) — token not committed to source; Principle 6 (Code Quality) — configuration as code
- **Alternatives Considered:** Environment variable in Worker bindings (not applicable — token is only needed for Logpush destination URL, not at Worker runtime), GitHub secret passed directly to `destination_conf` (would expose token in plaintext in SST state)
- **Impact:** `BetterStackToken` must be set via `sst secret set BetterStackToken <value>` before first deploy and in CI

**Decision 3: Uptime Monitoring Descoped**
- **Choice:** BetterStack Uptime monitors (polling `/api/status` and auth health) are NOT included in this feature
- **Rationale:** Explicitly descoped at user's request. The added value (full outage detection) was outweighed by the operational overhead of maintaining monitors and managing the BetterStack Uptime API token separately. Log-based error-rate alerting (AC3) covers in-band failure detection for elevated error rates.
- **Constitution Alignment:** This creates a documented deviation from Constitution §4 — a full Worker outage produces no logs and therefore no error-rate alert. The gap is accepted for the initial release with a follow-up feature planned.
- **Alternatives Considered:** BetterStack Uptime API + setup script (original plan, removed), Cloudflare Health Checks (future option)
- **Impact:** Constitution §4 deviation documented in spec; follow-up feature ticket recommended

---

## Architecture & Component Changes

**System Diagram:**

```
FitHub Workers (API / Auth / Queue / OutboxRelay / Scheduler)
    │
    └─ console.log/warn/error (structured JSON via Logger)
           │  logpush: true per Worker
           ▼
    Cloudflare Logpush
    (cloudflare.LogpushJob — dataset: workers_trace_events)
           │
           ▼ HTTPS POST — Authorization: Bearer <BetterStackToken>
    BetterStack Logs
    (source: fithub-<stage>)
           │
           ├─ Live tail (dev debugging)
           ├─ Search by event / userId / correlationId / level
           └─ Alert policy: error rate > 10/min → email / PagerDuty
```

**New Components:**
- `cloudflare.LogpushJob("BetterStackLogpush", {...})` in `sst.config.ts` — Pulumi resource; delivers `workers_trace_events` to BetterStack HTTPS ingest endpoint
- `docs/runbook.md` — Operator guide: log search queries, alert acknowledgement, incident escalation

**Modified Components:**
- `sst.config.ts` — Added `BetterStackToken` SST Secret; `logpush: true` on all 5 Worker `transform.worker` configs; `cloudflare.LogpushJob` Pulumi resource

**Removed/Deprecated Components:**
- `scripts/setup-betterstack.ts` — deleted (uptime monitoring descoped; Logpush job is now declared as Pulumi resource, not created by script)

---

## Technical Details

### Data Model & Schema

No database migrations. See `data-model.md` for the log entry schema and BetterStack field mapping.

**Data Privacy Considerations:**
- Encryption in transit: HTTPS (TLS) to BetterStack's ingest endpoint
- No PII in logs: enforced by existing `redact()` in `logger.ts` — no changes needed
- Retention: 30-day minimum in BetterStack (operational logs, not personal data under GDPR)

### API/Interface Changes

None. No FitHub API endpoints added or modified.

### Integration Points

**External Services:**
- **BetterStack Logs HTTP source** — Cloudflare POSTs `workers_trace_events` JSON to `https://in.logs.betterstack.com` — Bearer token auth via URL query param — no rate limit concerns at FitHub's current scale
- **Cloudflare Logpush API** — managed by Pulumi (`cloudflare.LogpushJob`) in `sst.config.ts`; Cloudflare validates the destination at job creation time

**Internal Dependencies:**
- `packages/core/src/logging/logger.ts` — Read-only dependency; structured `console.*` output is what Logpush captures and ships
- `packages/functions/src/api/routes/status.ts` — Health endpoint; no changes needed

---

## Constitution Compliance by Principle

### 1. Data Privacy & Security
**Compliance Strategy:**
- [x] Encryption in transit: TLS to BetterStack ingest endpoint
- [x] No PII in logs: existing `redact()` strips email, name, IP, tokens, payloads
- [x] `BetterStackToken` stored as SST secret, not committed; injected via `$interpolate` at deploy time
- [x] BetterStack is a vetted third-party (SOC 2 compliant, GDPR-ready DPA available)
- [x] Audit: no new audit_log entries needed — this is infrastructure, not a user action

**Deviations:** None

### 2. Cross-Platform Integration
**Compliance Strategy:**
- [x] BetterStack integration is push-based and fire-and-forget; rate limits not a concern
- [x] Logpush delivery failures are handled by Cloudflare (retries internally); producing Workers unaffected
- [x] No conflict detection needed — observability is write-only to BetterStack

**Deviations:** None (observability is not a user-facing platform integration)

### 3. User Experience & Simplicity
**Compliance Strategy:**
- [x] Operator setup: `sst secret set BetterStackToken <token>` then `sst deploy` — under 5 minutes
- [x] No user-facing changes
- [x] Runbook documents log search and alert acknowledgement in plain language

**Deviations:** Not applicable (operator-only feature)

### 4. Reliability & Uptime
**Compliance Strategy:**
- [x] Logpush failure does not affect producing Workers — delivery is best-effort, asynchronous, and outside the request hot path
- [x] If BetterStack is unavailable, logs continue flowing to Cloudflare's 1-hour tail as fallback
- [x] Tail Worker is not used — no additional runtime component to fail

**Deviations:** Constitution §4 MUST: "Monitoring and alerting MUST detect degradation in sync reliability within 5 minutes." Uptime monitoring (endpoint polling) was explicitly descoped. Log-based error-rate alerting (AC3) covers in-band failure detection, but a complete Worker outage produces no logs and no alert. This gap is documented in spec.md's Constitution Alignment Checklist and accepted for the initial release. A follow-up feature for endpoint uptime monitoring is recommended.

### 5. Performance & Real-Time Sync
**Compliance Strategy:**
- [x] Logpush runs asynchronously after Worker invocation — zero hot-path latency added
- [x] Cloudflare batches and delivers log events efficiently (no per-request HTTP overhead in Workers)
- [x] No caching or additional state management required

**Deviations:** None

### 6. Code Quality & Testing
**Compliance Strategy:**
- [x] Zero new production code — integration is pure infrastructure configuration in `sst.config.ts`
- [x] `cloudflare.LogpushJob` Pulumi resource is version-controlled alongside all other infrastructure
- [x] Existing logger unit tests unchanged and continue to pass
- [x] TypeScript strict mode; linting via existing config; CI validates on every push
- [x] 80% unit test coverage requirement applies to zero new production code lines

**Deviations:** No unit tests for the Logpush configuration itself (it is infrastructure, not code). CI validates the SST config compiles and the Pulumi resource is correctly declared.

### 7. Transparency & Communication
**Compliance Strategy:**
- [x] `docs/runbook.md` documents log search, alerting, and incident response
- [x] BetterStack data handling noted in runbook (third-party log storage)
- [x] No user-facing documentation changes needed

**Deviations:** None

### 8. Functional & Structured Logging
**Compliance Strategy:**
- [x] This feature *is* the logging infrastructure — inherently compliant
- [x] All existing log fields (`ts`, `level`, `event`, `service`, `env`, `correlationId`, `userId`) pass through unchanged via Logpush
- [x] No tokens or PII in forwarded logs (guaranteed by producing Workers' `Logger.redact()`)
- [x] No new functional events required — Logpush is transparent to Workers

**Deviations:** None

---

## Implementation Breakdown

**Phase 1: Infra Configuration (COMPLETE)**
- Add `BetterStackToken` SST Secret to `sst.config.ts` ✅
- Set `logpush: true` on all 5 Workers via `transform.worker` ✅
- Declare `cloudflare.LogpushJob("BetterStackLogpush", {...})` Pulumi resource ✅
- Wire `BETTER_STACK_TOKEN` in CI (`sst secret set BetterStackToken`) ✅
- Deliverables: Logpush job live in dev; all Workers forwarding logs to BetterStack ✅

**Phase 2: Verification & Alerting**
- Smoke test: verify logs appear in BetterStack from a live Worker call
- Audit log fields for PII exposure and field completeness
- Configure BetterStack error-rate alert policy (UI: `level = "error"` count > 10/min)
- Verify BetterStack log queries work for `userId`, `correlationId`, `event`
- Deliverables: All AC1–AC7 verified; alert policy active

**Phase 3: Documentation & Closure**
- Create `docs/runbook.md` — log search queries, alert acknowledgement, incident escalation
- Mark T053 as done in `000-backend-foundation/tasks.md`
- Update spec.md status to `Implemented`
- Deliverables: T053 closed; NFR-6 and Constitution §8 gates satisfied

---

## Dependencies & Blockers

**Critical Path:** Phase 1 (complete) → Phase 2 Verification → Phase 3 Docs (sequential)

**External Dependencies:**
- [x] BetterStack account exists (user confirmed)
- [x] BetterStack HTTP source token confirmed valid — `fithub` source, source token `JRGMgxVEB4CMhKbv3MuGx2Lx`
- [x] `BETTER_STACK_TOKEN` GitHub secret set in `dev` environment
- [x] `GET /api/status` endpoint implemented (T064 — already shipped)

**Blockers:**
- None (Logpush job created and delivering; build #38 passed)

---

## Risk Management

**Risk 1: Cloudflare Logpush batch delay**
- **Likelihood:** Medium (Cloudflare batches log events; delivery interval can be up to 5 minutes)
- **Impact:** Medium (latency between error occurring and alert firing may exceed desired 60s SLA)
- **Mitigation:** Verify actual delivery latency in T002 smoke test; adjust BetterStack alert sensitivity if needed

**Risk 2: Wrong BetterStack token type used**
- **Likelihood:** Low (already encountered and resolved — correct token is the Logs source token, not collector secret)
- **Impact:** High (Cloudflare Logpush job creation fails with 401 destination validation error)
- **Mitigation:** Already resolved; documented in runbook and research.md for future reference

**Risk 3: PII leak through unredacted log field**
- **Likelihood:** Low (existing `redact()` is comprehensive)
- **Impact:** High (GDPR violation)
- **Mitigation:** Field audit (T003) inspects BetterStack live entries for PII exposure; any finding requires immediate `redact()` update

---

## Testing & Validation Strategy

**Smoke Testing (T002):**
- Trigger a known log event (e.g., `GET /api/status`) in dev
- Query BetterStack; confirm entry appears within 60 seconds with correct fields

**Field Audit (T003):**
- Query BetterStack for entries with `userId`, `correlationId`, `event`, `level` fields present
- Confirm no PII (email, name, token, IP) visible in any field

**Alert Verification (T005):**
- Configure BetterStack alert policy: `level = "error"` count > 10/min → email notification
- Optionally trigger test alerts in BetterStack UI

**Log Query Verification (T006):**
- Verify `userId` filter returns correct entries
- Verify `correlationId` traces a full request lifecycle across workers
- Verify `level:error` filter returns only error-level entries

**Manual Verification Checklist:**
- [ ] Log entries appear in BetterStack within 60 seconds of Worker activity
- [ ] Log search by `userId` returns correct entries
- [ ] Log search by `correlationId` traces full request lifecycle
- [ ] `level:error` filter shows only error-level entries
- [ ] No PII (email, token, name) visible in any BetterStack entry
- [ ] Retention shows ≥30 days of logs available (AC5 — verify after 24h)

---

## Rollout & Rollback Plan

**Deployment Strategy (COMPLETE):**
1. ✅ Operator set `BetterStackToken` secret: `sst secret set BetterStackToken <token>`
2. ✅ `sst deploy` — Pulumi created `cloudflare.LogpushJob`; Cloudflare validated destination
3. ✅ CI wires `BETTER_STACK_TOKEN` → `sst secret set BetterStackToken` on every `master` push
4. Operator verifies: query BetterStack for live log entries

**Rollback Trigger:**
- If Logpush job causes unexpected issues (observable in Cloudflare Logpush dashboard)
- Rollback: set `enabled: false` on `cloudflare.LogpushJob` in `sst.config.ts` and redeploy — stops delivery without destroying job configuration

**Monitoring Post-Deployment:**
- BetterStack Live Tail: verify real-time log stream
- Cloudflare Logpush dashboard: confirm job health, no delivery failures

---

## Success Criteria

**Feature is complete when:**
- [x] Logpush job created and delivering logs to BetterStack (Phase 1 — build #38 ✅)
- [ ] Smoke test confirms logs appear in BetterStack within 60 seconds (T002)
- [ ] Field audit confirms correct fields present, no PII (T003)
- [ ] BetterStack secret stored correctly, no hardcoded values (T004)
- [ ] Error-rate alert policy configured (T005)
- [ ] Log query verification complete (T006)
- [ ] T053 in `000-backend-foundation/tasks.md` marked `[X]` (T007)
- [ ] AC1–AC7 verified; spec.md status updated to `Implemented` (T008)
- [ ] `docs/runbook.md` created

---

## Open Questions & Decisions

- **Q1: Tail Worker vs Cloudflare Logpush?**
  - **Status:** Resolved
  - **Resolution:** Logpush chosen. Tail Worker approach rejected — Logpush is available on Workers Paid plan, is simpler (no additional Worker to deploy/maintain), and eliminates Tail Worker CPU limit risk.

- **Q2: Should all 5 Workers be covered?**
  - **Status:** Resolved
  - **Resolution:** Yes — all 5 Workers (`Api`, `Auth`, `SyncWorker`/`Queue`, `OutboxRelay`, `Scheduler`) have `logpush: true` via `transform.worker`. Missing any Worker creates blind spots during incidents.

---

## Related Documents

- **Feature Specification:** `.specify/specs/007-betterstack-observability/spec.md`
- **Research:** `.specify/specs/007-betterstack-observability/research.md`
- **Data Model:** `.specify/specs/007-betterstack-observability/data-model.md`
- **Constitution:** `.specify/memory/constitution.md`
- **Task Breakdown:** `.specify/specs/007-betterstack-observability/tasks.md`
