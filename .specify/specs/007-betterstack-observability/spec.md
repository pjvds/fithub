# Feature Specification: BetterStack Observability

---

## Feature Overview

**Feature Name:** BetterStack Observability

**Feature ID:** feat-007-betterstack-observability

**Version:** 1.0.0

**Status:** Draft

**Authored By:** Copilot

**Date:** 2026-05-08

---

## Problem Statement

**What problem does this feature solve?**

FitHub's Workers emit richly structured JSON logs, but those logs currently exist only in Cloudflare's 1-hour rolling log tail — they cannot be searched, aggregated, alerted on, or retained beyond that window. When a sync job fails at 2 AM the team has no record of what happened, no alert that fired, and no dashboard showing whether the system is healthy.

Separately, there is no automated uptime check on FitHub's endpoints. An outage on the API or auth service goes unnoticed until a user reports it.

**Why now?**

FitHub has a BetterStack account ready to use. The logging infrastructure (structured JSON, typed event codes, field redaction) is complete. T053 in the backend foundation spec explicitly gates NFR-6 and Constitution §8 compliance on connecting a log aggregator. Wiring BetterStack in now means every subsequent feature ships with full observability from day one rather than retrofitting it later.

---

## Proposed Solution

**What is the feature?**

Connect FitHub's existing structured log output to BetterStack Logs and configure BetterStack Uptime to monitor the live service endpoints. After this feature ships:

- Every Worker log line (structured JSON) is shipped to BetterStack and permanently searchable
- BetterStack Uptime pings the health endpoint every minute and pages the team on failure
- Alerts fire on elevated error rates and failed sync jobs

**User Stories**

```
As an operator,
I want all FitHub Worker logs shipped to BetterStack,
so that I can search, filter, and alert on structured log events beyond Cloudflare's 1-hour window.

As an operator,
I want BetterStack Uptime to monitor the FitHub API and auth endpoints,
so that I receive an immediate alert if either goes down.

As an operator,
I want to be alerted when the error rate in FitHub Workers rises above a threshold,
so that I can investigate problems before users report them.

As a developer,
I want to query logs by userId, correlationId, or event code,
so that I can trace the full lifecycle of a sync job or auth event for debugging.
```

**Acceptance Criteria**

- [ ] AC1: Every structured JSON log line emitted by all FitHub Workers (API Worker, Auth Worker, Queue Worker, Scheduler) appears in BetterStack Logs within 60 seconds of emission
- [ ] AC2: Logs are searchable by `event`, `level`, `service`, `userId`, and `correlationId` fields in BetterStack
- [ ] AC3: BetterStack Uptime checks `GET /api/status` every minute; a failure triggers an alert within 5 minutes
- [ ] AC4: BetterStack Uptime checks the Auth endpoint's health path every minute with the same alerting SLA
- [ ] AC5: An alert fires when `error`-level log events exceed 10 per minute across any Worker
- [ ] AC6: No tokens, secrets, PII (email, name, IP), or raw third-party payloads appear in BetterStack — the existing field-redaction layer guarantees this
- [ ] AC7: Log retention in BetterStack is at least 30 days for `info`/`warn`/`error` levels
- [ ] AC8: The BetterStack source token is stored as a secret (not committed to the repository)
- [ ] AC9: Configuration is reproducible — a new environment (staging, prod) can be wired to BetterStack by setting one secret and deploying, with no manual clicks in the BetterStack UI required beyond initial source/monitor creation

---

## Constitution Alignment Checklist

### ✅ Data Privacy & Security
- [x] No tokens, PII, or raw payloads appear in shipped logs — enforced by the existing `redact()` function in `logger.ts`
- [x] BetterStack source token treated as a secret (env var, not committed)
- [x] Log data transmitted over HTTPS (BetterStack Logs ingestion uses TLS)
- [x] BetterStack is a third-party service — access limited to operations team; no user data beyond `userId` (a non-identifiable UUID) is present in logs
- **Notes:** The existing `REDACT_KEYS` set already strips email, name, IP, tokens, and raw payloads. No changes to field redaction needed.

### ✅ Cross-Platform Integration
- [x] BetterStack integration uses Cloudflare's native Workers Logpush or Tail Worker — no custom HTTP sink required
- [x] Rate limits: BetterStack free/starter tier handles FitHub's current log volume (well within limits at launch scale)
- [x] No conflict detection needed — observability is read-only
- **Notes:** Cloudflare Logpush is push-based; BetterStack provides the HTTPS endpoint. No polling, no retry complexity on FitHub's side.

### ✅ User Experience & Simplicity
- [x] This is an operator-facing feature; no user-visible UI changes
- [x] Incident alert messages are actionable (include service name, endpoint, timestamp)
- **Notes:** Users are unaffected. Operators gain a dashboard and alert channel.

### ✅ Reliability & Uptime
- [x] BetterStack Uptime monitors the `/api/status` and auth health endpoints
- [x] Log shipping failure (BetterStack unavailable) does not affect Worker execution — logs are best-effort via Logpush; Workers continue operating normally
- [x] BetterStack itself has 99.9% uptime SLA; acceptable for observability infrastructure
- **Notes:** Log shipping is fire-and-forget from the Worker's perspective. Loss of observability does not cause data loss or service degradation.

### ✅ Performance & Real-Time Sync
- [x] Log shipping is asynchronous (Logpush/Tail Worker runs outside the request hot path)
- [x] No latency added to API responses
- [x] Uptime checks are external (no load added to Workers beyond responding to health pings)
- **Notes:** BetterStack's Cloudflare integration uses Logpush which buffers and batches — zero impact on Worker response times.

### ✅ Code Quality & Testing
- [x] Tail Worker (if used) is a simple passthrough — minimal surface area, low test burden
- [x] Configuration-as-code verified in CI (SST config with secrets)
- [x] Existing logger unit tests continue to pass unchanged
- **Notes:** The logger itself doesn't change. The integration point is Cloudflare Logpush configuration in SST/infra.

### ✅ Transparency & Communication
- [x] BetterStack data handling: operators are the only consumers; no user-facing disclosure needed beyond existing privacy policy reference to third-party infrastructure
- [x] Runbook: how to access logs, how to silence/acknowledge alerts — documented in `docs/runbook.md` (created as part of this feature)
- **Notes:** Users are not directly affected. A brief note in the ops documentation covers the change.

### ✅ Functional & Structured Logging
- [x] This feature *is* the logging infrastructure — it is inherently compliant
- [x] `logpush.connected` / `logpush.error` events emitted by the Tail Worker (if applicable)
- [x] All existing log events flow through without modification
- **Notes:** No new functional log events required beyond the infrastructure bootstrap events.

---

## Technical Specification

### Scope

**In Scope:**
- Configuring Cloudflare Logpush (or a Tail Worker) to forward all FitHub Worker `console.*` output to BetterStack Logs
- Creating BetterStack Uptime monitors for `GET /api/status` and the Auth Worker health path
- Configuring at least one alert policy: error-rate spike and downtime
- Storing the BetterStack source token as an SST secret
- Creating a minimal operator runbook (`docs/runbook.md`) covering log search and alert acknowledgement

**Out of Scope:**
- Custom dashboards in BetterStack (can be built manually by the operator post-launch)
- Alerting on individual business events beyond error rate and downtime (e.g., "alert when a specific user's sync fails" — that is a future feature)
- Log-based billing/cost analysis dashboards
- Changing the logger implementation or log schema

### Technical Constraints

- **Platform:** Cloudflare Workers — log forwarding must use Cloudflare Logpush or a Tail Worker bound to the existing Workers
- **Secret management:** BetterStack source token stored via SST secrets (`sst secret set BetterStackToken <value>`)
- **No code changes to logger:** The `Logger` class in `packages/core/src/logging/logger.ts` writes structured JSON to `console.*` — this is correct and requires no modification
- **BetterStack source type:** HTTP source (Logpush destination) or the BetterStack Cloudflare integration (which internally uses Logpush)
- **Retention:** Minimum 30-day hot retention for `info`/`warn`/`error` — covered by BetterStack's standard plan

### Architecture & Components

```
FitHub Workers (API / Auth / Queue / Scheduler)
    │
    └─ console.log/warn/error (structured JSON)
           │
           ▼
    Cloudflare Logpush
    (configured per Worker; pushed on flush)
           │
           ▼ HTTPS (TLS)
    BetterStack Logs
    (source: fithub-<stage>)
           │
           ├─ Live tail (dev debugging)
           ├─ Search by event/userId/correlationId
           └─ Alert policy: error rate > 10/min
                  │
                  └─ Email / PagerDuty alert

BetterStack Uptime (external, no Worker involvement)
    │
    ├─ GET /api/status          (every 1 min)
    └─ GET /auth/health          (every 1 min)
           │
           └─ Alert: downtime detected → page team
```

**Component Changes:**
- **`sst.config.ts`**: Add Logpush configuration pointing at BetterStack source URL; bind `BetterStackToken` secret to Workers
- **Tail Worker** _(optional, if Logpush JSON format needs reshaping)_: Minimal Worker that receives tail events and forwards to BetterStack HTTP source
- **`docs/runbook.md`** _(new)_: Operator guide for log search, alert acknowledgement, and incident response

---

## Testing Strategy

**Unit Tests:**
- No changes to `Logger` class → existing logger tests pass without modification
- If a Tail Worker is added: unit test that it forwards structured events and drops events on BetterStack HTTP error

**Integration Tests:**
- Deploy to staging, emit a test log event via `POST /api/status`, verify the event appears in BetterStack within 60 seconds
- Verify `error`-level log event triggers the alert policy in BetterStack staging source

**End-to-End Tests:**
- Simulate a Worker error; confirm alert fires in BetterStack and reaches the configured notification channel
- Bring down staging Worker (disable); confirm Uptime monitor detects failure within 5 minutes

**Manual Verification Checklist:**
- [ ] Log search by `userId` returns correct events
- [ ] Log search by `correlationId` traces a full sync job
- [ ] Uptime monitor shows green for both endpoints on healthy deploy
- [ ] Error-rate alert fires on injected error spike (test mode)
- [ ] No PII or tokens visible in BetterStack log viewer

---

## Success Metrics

- 100% of structured log events from FitHub Workers are visible in BetterStack within 60 seconds of emission (verified via integration test)
- Uptime alert fires within 5 minutes of an endpoint becoming unavailable
- Zero incidents go undetected for more than 5 minutes after this feature ships
- Zero PII or secret values visible in any BetterStack log entry (verified via log audit)
- Developer can trace a complete sync job (start → finish or failure) using only BetterStack log search

---

## Assumptions

1. The BetterStack account has been created and the team has access to create sources and uptime monitors
2. Cloudflare Logpush supports HTTP destinations (it does — this is a standard Logpush destination type)
3. The existing logger's structured JSON output (with field redaction) is already BetterStack-compatible — no schema transformation needed
4. `GET /api/status` (T064, already implemented) is the canonical health endpoint; auth health can be checked via a simple `GET /` returning 200
5. A Tail Worker approach is used as fallback if Logpush HTTP destination is unavailable on the current Cloudflare plan

---

## Open Questions & Decisions

- **Q1: Logpush vs Tail Worker?**
  - **Resolution:** Prefer Logpush HTTP destination (simpler, zero FitHub code). Fall back to Tail Worker if the Cloudflare plan doesn't support HTTP Logpush destinations. The spec is implementation-agnostic on this point.

- **Q2: Separate BetterStack sources per environment (dev/staging/prod)?**
  - **Resolution:** Yes — use separate sources (`fithub-dev`, `fithub-prod`) so staging noise doesn't pollute production alerts. SST stages map naturally to this.

---

## Related Documents

- Constitution: `.specify/memory/constitution.md`
- Backend foundation tasks (T053): `.specify/specs/000-backend-foundation/tasks.md`
- Logger implementation: `packages/core/src/logging/logger.ts`
- Status endpoint: `packages/functions/src/api/routes/status.ts`
- Implementation Plan: _(to be created — run speckit-plan)_
- Task Breakdown: _(to be created — run speckit-tasks)_
