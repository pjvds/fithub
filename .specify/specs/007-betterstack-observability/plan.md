# Implementation Plan: BetterStack Observability

**Feature:** BetterStack Observability (Reference: `.specify/specs/007-betterstack-observability/spec.md`)

**Plan ID:** plan-feat-007-betterstack-observability

**Version:** 1.0.0

**Planned By:** Copilot

**Date:** 2026-05-08

---

## Problem & Approach

**Feature Problem:**
FitHub Workers emit richly structured JSON logs that are only visible in Cloudflare's 1-hour rolling tail. There is no persistent log storage, no cross-session search, no uptime monitoring, and no alerting. Incidents at 2 AM go undetected until a user reports them.

**Implementation Approach:**
Deploy a Cloudflare **Tail Worker** that receives log events from all FitHub Workers and forwards them to BetterStack Logs via HTTP. Add BetterStack Uptime monitors for the API and Auth endpoints via a one-time setup script. Store the BetterStack token as an SST secret. No changes to the existing `Logger` class or any producing Workers beyond adding the `tailConsumers` binding in `sst.config.ts`.

---

## Design Decisions & Rationale

**Decision 1: Tail Worker over Logpush**
- **Choice:** Cloudflare Tail Worker receiving `TraceItem[]` and forwarding NDJSON to BetterStack
- **Rationale:** Logpush HTTP destinations require Cloudflare Business/Enterprise tier. Tail Workers are available on all plans and are the standard pattern for Workers observability.
- **Constitution Alignment:** Principle 4 (Reliability) — observability without plan upgrade dependency; Principle 8 (Logging) — all Workers covered by a single Tail Worker binding
- **Alternatives Considered:** Logpush (plan cost), in-Worker fetch (hot-path coupling, rejected)
- **Impact:** New Worker to deploy (`TailWorker`); 1-line config change per producing Worker in `sst.config.ts`

**Decision 2: Separate BetterStack Sources per Stage**
- **Choice:** `BetterStackToken` SST secret set per stage (`dev`, `production`); each stage posts to its own BetterStack source
- **Rationale:** Prevents staging errors from polluting production alert policies and dashboards
- **Constitution Alignment:** Principle 6 (Code Quality) — environment isolation; Principle 4 (Reliability) — production alerts not drowned by dev noise
- **Alternatives Considered:** Single shared source with `env` field filter (acceptable, but harder to set alert thresholds independently)
- **Impact:** Operator must create two BetterStack sources and set the secret twice (`sst secret set BetterStackToken ... --stage production`)

**Decision 3: Uptime via Setup Script (not UI-only)**
- **Choice:** `scripts/setup-betterstack.ts` — one-time TypeScript script using BetterStack API to create monitors; idempotent
- **Rationale:** Manual UI configuration is not reproducible or code-reviewable. A script documents the monitor configuration and can be re-run for new environments.
- **Constitution Alignment:** Principle 6 (Code Quality) — configuration as code; Principle 7 (Transparency) — documented monitoring configuration
- **Alternatives Considered:** Manual BetterStack UI (not reproducible), Terraform/Pulumi BetterStack provider (overkill for 2 monitors)
- **Impact:** Operator runs script once per environment after initial deploy

---

## Architecture & Component Changes

**System Diagram:**

```
┌─────────────────────────────────────────────────────┐
│  FitHub Cloudflare Workers                          │
│                                                     │
│  ┌──────┐ ┌──────┐ ┌────────────┐ ┌───────────┐    │
│  │ Api  │ │ Auth │ │ SyncWorker │ │ Scheduler │    │
│  └──┬───┘ └──┬───┘ └─────┬──────┘ └─────┬─────┘    │
│     │tail   │tail        │tail          │tail       │
│     └────────┴────────────┴──────────────┘          │
│                           │                         │
│                    ┌──────▼──────┐                  │
│                    │ TailWorker  │                  │
│                    └──────┬──────┘                  │
└───────────────────────────┼─────────────────────────┘
                            │ HTTPS NDJSON
                            ▼
                    ┌───────────────┐
                    │  BetterStack  │
                    │     Logs      │
                    │  (searchable, │
                    │  alertable)   │
                    └───────────────┘

BetterStack Uptime (external, cron-based polling):
  GET https://api.fithub.space/api/status  ──► alert on failure
  GET https://auth.fithub.space            ──► alert on failure
```

**New Components:**
- `packages/functions/src/tail/index.ts` — Tail Worker: receives `TraceItem[]`, extracts and normalises log entries, POSTs NDJSON to BetterStack
- `scripts/setup-betterstack.ts` — One-time setup script: creates BetterStack uptime monitors via API; idempotent
- `docs/runbook.md` — Operator guide: log search queries, alert acknowledgement, incident escalation

**Modified Components:**
- `sst.config.ts` — Add `BetterStackToken` secret; add `TailWorker`; add `tailConsumers` binding to Api, Auth, SyncWorker, OutboxRelay, Scheduler Workers

**Removed/Deprecated Components:**
- None

---

## Technical Details

### Data Model & Schema

No database migrations. See `data-model.md` for the full log entry schema and BetterStack field mapping.

**Data Privacy Considerations:**
- Encryption in transit: HTTPS (TLS) to BetterStack's ingest endpoint
- No PII in logs: enforced by existing `redact()` in `logger.ts` — no changes needed
- Retention: 30-day minimum in BetterStack (operational logs, not personal data under GDPR)

### API/Interface Changes

None. No FitHub API endpoints added or modified.

### Integration Points

**External Services:**
- **BetterStack Logs HTTP source** — NDJSON POST to `https://in.logs.betterstack.com` — Bearer token auth — no rate limit concerns at FitHub's current scale
- **BetterStack Uptime API** — Setup script only — `POST /api/v2/monitors` — Bearer token auth — called once per environment setup

**Internal Dependencies:**
- `packages/core/src/logging/logger.ts` — Read-only dependency; Tail Worker consumes its output format
- `packages/functions/src/api/routes/status.ts` — Consumed by BetterStack Uptime; no changes needed

---

## Constitution Compliance by Principle

### 1. Data Privacy & Security
**Compliance Strategy:**
- [x] Encryption in transit: TLS to BetterStack ingest endpoint
- [x] No PII in logs: existing `redact()` strips email, name, IP, tokens, payloads
- [x] `BetterStackToken` stored as SST secret, not committed
- [x] BetterStack is a vetted third-party (SOC 2 compliant, GDPR-ready DPA available)
- [x] Audit: no new audit_log entries needed — this is infrastructure, not a user action

**Deviations:** None

### 2. Cross-Platform Integration
**Compliance Strategy:**
- [x] BetterStack integration is fire-and-forget (no response processing); rate limits not a concern
- [x] Tail Worker silently swallows BetterStack errors to avoid cascading into producing Workers
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
- [x] Tail Worker failure does not affect producing Workers — Cloudflare's tail delivery is best-effort
- [x] If BetterStack is unavailable, logs continue flowing to Cloudflare's 1-hour tail as fallback
- [x] BetterStack Uptime monitors alert on API and Auth downtime within 5 minutes
- [x] Tail Worker has no state to persist — stateless, no D1/KV dependency

**Deviations:** None

### 5. Performance & Real-Time Sync
**Compliance Strategy:**
- [x] Tail Worker runs asynchronously after producing Worker — zero hot-path latency added
- [x] NDJSON batch: all log entries from a single invocation sent in one HTTP request (efficient)
- [x] No caching needed in Tail Worker

**Deviations:** None

### 6. Code Quality & Testing
**Compliance Strategy:**
- [x] Unit tests: Tail Worker log normalisation (happy path, BetterStack error, missing fields)
- [x] Integration test: deploy to dev stage, emit log, verify appears in BetterStack within 60s
- [x] Existing logger tests unchanged
- [x] TypeScript strict mode; linting via existing config
- [x] Setup script tested with `--dry-run` flag before live execution

**Deviations:** Tail Worker is infrastructure glue — 80% unit test coverage target applies to the normalisation logic specifically

### 7. Transparency & Communication
**Compliance Strategy:**
- [x] `docs/runbook.md` documents log search, alerting, and incident response
- [x] BetterStack data handling noted in runbook (third-party log storage)
- [x] No user-facing documentation changes needed

**Deviations:** None

### 8. Functional & Structured Logging
**Compliance Strategy:**
- [x] This feature *is* the logging infrastructure — inherently compliant
- [x] Event vocabulary for Tail Worker itself: `tail.forward.success`, `tail.forward.error` (written to `console.error` only when BetterStack is unreachable — these appear in Cloudflare's own tail, not BetterStack, to avoid circular dependency)
- [x] All existing log fields (`ts`, `level`, `event`, `service`, `env`, `correlationId`, `userId`) pass through unchanged
- [x] No tokens or PII in forwarded logs (guaranteed by producing Workers' `Logger.redact()`)

**Deviations:** None

---

## Implementation Breakdown

**Phase 1: Tail Worker & SST Wiring**
- Add `BetterStackToken` secret to `sst.config.ts`
- Create `packages/functions/src/tail/index.ts` — Tail Worker implementation
- Add `TailWorker` to `sst.config.ts`; bind `tailConsumers` on all 5 producing Workers
- Unit tests for Tail Worker normalisation logic
- Deliverables: Tail Worker deployed; all Workers forwarding logs to BetterStack

**Phase 2: Uptime Monitoring & Alerts**
- Create `scripts/setup-betterstack.ts` — uptime monitor setup script
- Configure BetterStack alert policy: error-rate > 10/min
- Run setup script against dev and prod environments
- Deliverables: Both uptime monitors active; error-rate alert configured

**Phase 3: Runbook & T053 Closure**
- Create `docs/runbook.md` — log search queries, alert acknowledgement, incident escalation
- Mark T053 as `[X]` in `000-backend-foundation/tasks.md`
- Verify AC1–AC9 from spec
- Deliverables: T053 closed; NFR-6 and Constitution §8 gates satisfied

---

## Dependencies & Blockers

**Critical Path:** Phase 1 → Phase 2 → Phase 3 (sequential; each phase is a day of work)

**External Dependencies:**
- [x] BetterStack account exists (user confirmed)
- [x] `GET /api/status` endpoint implemented (T064 — already shipped)
- [ ] BetterStack HTTP source token — operator must create source in BetterStack UI and provide token via `sst secret set BetterStackToken`
- [ ] BetterStack Uptime API token — separate token for setup script (or same account token)

**Blockers:**
- None (BetterStack account ready; Cloudflare Tail Workers available on current plan)

---

## Risk Management

**Risk 1: Tail Worker exceeds Cloudflare CPU time limit**
- **Likelihood:** Low (HTTP POST is fast; no heavy computation)
- **Impact:** Medium (tail delivery silently fails for that invocation)
- **Mitigation:** Keep Tail Worker logic minimal (parse → map fields → POST). Add timeout to `fetch()` call (5s max).

**Risk 2: BetterStack ingest endpoint rate limit**
- **Likelihood:** Low (FitHub's current log volume is well within BetterStack's limits)
- **Impact:** Low (some logs dropped; not a data-loss scenario)
- **Mitigation:** Monitor Tail Worker outcome metrics in Cloudflare dashboard. If needed, batch with a KV counter (future enhancement).

**Risk 3: `tailConsumers` SST Ion API not available**
- **Likelihood:** Low (confirmed in Cloudflare Pulumi provider docs)
- **Impact:** High (can't bind Tail Worker without this)
- **Mitigation:** Use `transform.worker` raw property injection as fallback. Document workaround.

---

## Testing & Validation Strategy

**Unit Testing:**
- Tail Worker: given `TraceItem[]` with valid Logger JSON → produces correct NDJSON
- Tail Worker: given `TraceItem[]` with non-JSON console output → skips entry gracefully
- Tail Worker: BetterStack returns non-2xx → logs error to stderr, continues (no throw)
- Tail Worker: empty `logs[]` array → sends nothing, no HTTP call

**Integration Testing:**
- Deploy to dev stage; trigger a known log event (e.g., `GET /api/status`); query BetterStack and confirm entry appears with correct fields within 60 seconds

**E2E Testing:**
- Full error flow: inject a deliberate error in a test endpoint; confirm BetterStack log entry appears; confirm alert policy would fire (test mode or count threshold observation)

**Manual Testing Checklist:**
- [ ] Log search by `userId` returns correct entries
- [ ] Log search by `correlationId` traces full request lifecycle
- [ ] `level:error` filter shows only error-level entries
- [ ] Uptime monitor shows green on healthy deploy
- [ ] No PII (email, token, name) visible in any BetterStack entry

---

## Rollout & Rollback Plan

**Deployment Strategy:**
1. Operator sets `BetterStackToken` secret: `sst secret set BetterStackToken <token>`
2. `sst deploy` — deploys TailWorker and updated producing Workers with `tailConsumers`
3. Operator runs `npx tsx scripts/setup-betterstack.ts` to create uptime monitors
4. Verify logs appearing in BetterStack within 60 seconds

**Rollback Trigger:**
- If Tail Worker causes unexpected CPU spikes or producing Worker failures (observable in Cloudflare dashboard)
- Rollback: remove `tailConsumers` from `sst.config.ts` and redeploy — instant isolation

**Monitoring Post-Deployment:**
- BetterStack Uptime monitors active within minutes of setup script run
- Verify `tail.forward.error` events are absent in Cloudflare's own log tail

---

## Success Criteria

**Feature is complete when:**
- [x] All acceptance criteria AC1–AC9 from spec verified
- [x] Unit tests for Tail Worker normalisation logic pass
- [x] Logs from all 5 Workers visible in BetterStack within 60 seconds
- [x] Both uptime monitors active and green
- [x] Error-rate alert configured
- [x] `docs/runbook.md` created
- [x] T053 in `000-backend-foundation/tasks.md` marked `[X]`
- [x] No PII visible in BetterStack log viewer

---

## Open Questions & Decisions

- **Q1: Same BetterStack token for Logs and Uptime?**
  - **Status:** Resolved
  - **Resolution:** BetterStack uses separate tokens per product (Logs source token ≠ Uptime API token). The setup script needs a Uptime API token; the Tail Worker needs the Logs source ingest token. Document both in runbook.

- **Q2: Should OutboxRelay and Scheduler be covered by the Tail Worker?**
  - **Status:** Resolved
  - **Resolution:** Yes — all 5 Workers emit structured logs and should be covered. Missing any Worker creates blind spots during incidents.

---

## Related Documents

- **Feature Specification:** `.specify/specs/007-betterstack-observability/spec.md`
- **Research:** `.specify/specs/007-betterstack-observability/research.md`
- **Data Model:** `.specify/specs/007-betterstack-observability/data-model.md`
- **Contracts:** `.specify/specs/007-betterstack-observability/contracts/tail-worker-contract.md`
- **Constitution:** `.specify/memory/constitution.md`
- **Task Breakdown:** `.specify/specs/007-betterstack-observability/tasks.md` _(to be created — run speckit-tasks)_
