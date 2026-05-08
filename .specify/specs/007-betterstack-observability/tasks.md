# Task Breakdown: BetterStack Observability

**Feature:** BetterStack Observability

**Feature ID:** feat-007-betterstack-observability

**Plan Reference:** `.specify/specs/007-betterstack-observability/plan.md`

**Breakdown Date:** 2026-05-08 (revised after Logpush pivot)

**Breakdown Author:** Copilot

**Status:** Draft

---

## Task Summary

**Total Tasks:** 12

**Critical Path Length:** 3 phases (Setup → Log Shipping → Monitoring & Polish)

**Parallel Opportunities:** T003 (setup script) is independent of T001/T002 (SST changes)

**Priority Blockers:** T001 (logpush enabled on Workers), T002 (Logpush job created)

---

## User Stories

| ID  | Story |
|-----|-------|
| US1 | As an **operator**, I want all FitHub Worker logs shipped to BetterStack, so that I can search, filter, and alert on structured log events beyond Cloudflare's 1-hour window. |
| US2 | As an **operator**, I want BetterStack Uptime to monitor the FitHub API and auth endpoints, so that I receive an immediate alert if either goes down. |
| US3 | As an **operator**, I want to be alerted when the error rate rises above a threshold, so that I can investigate problems before users report them. |
| US4 | As a **developer**, I want to query logs by `userId`, `correlationId`, or `event` code, so that I can trace the full lifecycle of a sync job or auth event for debugging. |

---

## Phase 1: SST — Enable Logpush on All Workers

> `logpush: true` must be set on each Worker script before Cloudflare will include it in Logpush jobs.

- [x] T001 Add `logpush: true` to all 5 Workers in `sst.config.ts` via `transform.worker`: Auth, Api (merged into existing `serviceBindings` transform), OutboxRelay, Scheduler, SyncWorker

---

## Phase 2: Cloudflare Logpush Job Setup

> Create the Logpush job that delivers Workers Trace Events to BetterStack.

- [ ] T002 [US1] Run `scripts/setup-betterstack.ts` to create the Cloudflare Logpush job (`dataset: "workers_trace_events"`) pointing at the BetterStack HTTPS ingest endpoint; confirm job appears in the Cloudflare dashboard as enabled
- [ ] T003 Create `scripts/setup-betterstack.ts` — idempotent script that: (1) creates Cloudflare Logpush job via `POST /accounts/{id}/logpush/jobs` with `dataset: "workers_trace_events"` and `destination_conf: "https://in.logs.betterstack.com?header_Authorization=Bearer%20TOKEN"`; (2) creates BetterStack Uptime monitors; supports `--dry-run`; reads `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `BETTER_STACK_TOKEN`, `BETTERSTACK_API_KEY` from env

> Note: T003 already complete (script created at `scripts/setup-betterstack.ts`).

---

## Phase 3: US1 — Log Shipping Verification

> Verify all FitHub Worker logs ship to BetterStack and AC1/AC2/AC6/AC8 pass.

- [ ] T004 [US1] Deploy to dev stage (`sst deploy`) after T001 is deployed; trigger `GET /api/status` and confirm a structured log entry appears in BetterStack Logs within 60 seconds (AC1)
- [ ] T005 [US1] Audit BetterStack log entries from T004: verify `event`, `level`, `service`, `userId`, `correlationId` fields are present and queryable (AC2); verify no email, token, name, or raw payload visible (AC6)
- [ ] T006 [P] [US1] Verify AC8: run `git grep -r "BETTER_STACK_TOKEN\|betterstack" --include="*.ts" --include="*.env*"` and confirm no plaintext token appears in committed files

---

## Phase 4: US2 — Uptime Monitoring

> Create BetterStack Uptime monitors via the setup script.

- [ ] T007 [US2] Run setup script with `BETTERSTACK_API_KEY` set to create uptime monitors for `FitHub API /health` and `FitHub Auth /health`; confirm both monitors appear in the BetterStack Uptime dashboard and show green status (AC3, AC4)

---

## Phase 5: US3 — Error Rate Alerting

> Configure BetterStack alert policy for elevated error rates.

- [ ] T008 [US3] In BetterStack Logs dashboard for the `fithub-dev` source: create alert — query `level = "error"`, threshold `> 10 occurrences in 1 minute`, notification channel = email/Slack; document the exact alert configuration in `docs/runbook.md` (AC5); note: BetterStack Logs alert creation is not yet available via API — manual UI step

---

## Phase 6: US4 — Developer Log Querying

> Confirm BetterStack search capabilities cover developer debugging needs.

- [ ] T009 [US4] In BetterStack Logs, verify queries against real entries from T004: `userId:"<uuid>"`, `correlationId:"<id>"`, `event:status.queried`, `service:"api"`, `level:error` all return expected results (AC2)

---

## Phase 7: Polish & Closure

- [ ] T010 Create `docs/runbook.md` covering: (a) log search queries cheat-sheet, (b) how to acknowledge/silence an alert, (c) incident escalation steps, (d) BetterStack data handling note (third-party storage, 30-day retention), (e) how to onboard a new environment (create BetterStack source, run setup script, deploy) (AC7, AC9)
- [ ] T011 Mark T053 as `[X]` in `.specify/specs/000-backend-foundation/tasks.md` (closes NFR-6 and Constitution §8 compliance gate)
- [ ] T012 [P] Verify all acceptance criteria AC1–AC9 against the deployed dev environment; update spec.md Status from `Draft` to `Implemented`

---

## Task Dependency Graph

```
T001 (logpush: true on 5 Workers) ──► T004 (deploy + smoke test) ──► T005 ──► T006 [P]

T003 (setup script) ──► T002 (run: create Logpush job + monitors) ──► T007 (uptime monitors)

T004 + T007 + T008 (alert policy) + T009 (query verification)
  └──► T010 (runbook) ──► T011 (close T053) ──► T012 (AC checklist)
```

---

## Quick Reference Checklist

**Phase 1 — SST logpush**
- [x] T001 logpush: true on all 5 Workers

**Phase 2 — Logpush job**
- [ ] T002 Run setup script
- [x] T003 Setup script created

**Phase 3 — US1: Log Shipping**
- [ ] T004 Deploy + smoke test
- [ ] T005 Field audit
- [ ] T006 Secret hygiene check

**Phase 4 — US2: Uptime Monitoring**
- [ ] T007 Run monitors

**Phase 5 — US3: Error Rate Alerting**
- [ ] T008 Alert policy

**Phase 6 — US4: Developer Log Querying**
- [ ] T009 Query verification

**Phase 7 — Polish**
- [ ] T010 Runbook
- [ ] T011 Close T053
- [ ] T012 AC1–AC9 verification

---

## Implementation Strategy

**MVP Scope (US1 only):** T001 (done) → T003 (done) → T002 (run script) → T004 → T005 → T006

Completing US1 alone satisfies AC1, AC2, AC6, AC8 and makes logs immediately searchable in BetterStack. US2–US4 and the polish phase can follow in any order once US1 is green.

---

## Related Documents

- **Feature Spec:** `.specify/specs/007-betterstack-observability/spec.md`
- **Implementation Plan:** `.specify/specs/007-betterstack-observability/plan.md`
- **Research:** `.specify/specs/007-betterstack-observability/research.md`
- **Data Model:** `.specify/specs/007-betterstack-observability/data-model.md`
- **Setup Script:** `scripts/setup-betterstack.ts`
- **Quickstart:** `.specify/specs/007-betterstack-observability/quickstart.md`
- **Constitution:** `.specify/memory/constitution.md`
- **Closes:** `.specify/specs/000-backend-foundation/tasks.md` T053
