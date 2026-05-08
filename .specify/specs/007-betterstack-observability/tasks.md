# Task Breakdown: BetterStack Observability

**Feature:** BetterStack Observability

**Feature ID:** feat-007-betterstack-observability

**Plan Reference:** `.specify/specs/007-betterstack-observability/plan.md`

**Breakdown Date:** 2026-05-08

**Breakdown Author:** Copilot

**Status:** Draft

---

## Task Summary

**Total Tasks:** 15

**Critical Path Length:** 3 phases (Phase 1 → Phase 2 → Polish)

**Parallel Opportunities:** T002 + T009 (after T001 and T003/T004 are done, Tail Worker impl and setup script are independent)

**Priority Blockers:** T001 (secret config), T002 (Tail Worker), T003/T004 (SST wiring)

---

## User Stories

| ID  | Story |
|-----|-------|
| US1 | As an **operator**, I want all FitHub Worker logs shipped to BetterStack, so that I can search, filter, and alert on structured log events beyond Cloudflare's 1-hour window. |
| US2 | As an **operator**, I want BetterStack Uptime to monitor the FitHub API and auth endpoints, so that I receive an immediate alert if either goes down. |
| US3 | As an **operator**, I want to be alerted when the error rate rises above a threshold, so that I can investigate problems before users report them. |
| US4 | As a **developer**, I want to query logs by `userId`, `correlationId`, or `event` code, so that I can trace the full lifecycle of a sync job or auth event for debugging. |

---

## Phase 1: Setup

> SST secret and Tail Worker resource declared before any implementation.

- [ ] T001 Add `BetterStackToken` SST secret declaration to `sst.config.ts`

---

## Phase 2: Foundational — Tail Worker & SST Wiring

> All producing Workers must have `tailConsumers` before logs can flow.

- [ ] T002 Create Tail Worker handler in `packages/functions/src/tail/index.ts` (receives `TraceItem[]`, extracts JSON log lines, POSTs NDJSON to BetterStack via `BetterStackToken` binding; swallows non-2xx silently and emits `console.error("tail.forward.error")`)
- [ ] T003 Add `TailWorker` Cloudflare Worker resource to `sst.config.ts` (entry: `packages/functions/src/tail/index.ts`, binds `BetterStackToken` secret)
- [ ] T004 Add `tailConsumers` binding to all 5 producing Workers in `sst.config.ts` via `transform.worker`: Api, Auth, SyncWorker, OutboxRelay, Scheduler → point to `TailWorker.name`
- [ ] T005 [P] Write unit tests for Tail Worker normalisation in `packages/functions/test/tail.test.ts`: (a) valid `TraceItem[]` with JSON log lines → correct NDJSON output; (b) non-JSON console output → entry skipped; (c) BetterStack non-2xx → no throw, `console.error` called; (d) empty `logs[]` → no HTTP call made

---

## Phase 3: US1 — Log Shipping

> Verify all FitHub Worker logs ship to BetterStack and AC1/AC2/AC6/AC8 pass.

- [ ] T006 [US1] Deploy to dev stage (`sst deploy`) after setting `BetterStackToken` secret; trigger `GET /api/status` and confirm a structured log entry appears in BetterStack Logs within 60 seconds (AC1)
- [ ] T007 [US1] Audit BetterStack log entries from the test request in T006: verify `event`, `level`, `service`, `userId`, `correlationId` fields are present and queryable (AC2); verify no email, token, name, or raw payload visible (AC6)
- [ ] T008 [P] [US1] Verify AC8: run `git grep -r "BetterStackToken" --include="*.ts" --include="*.env*"` and confirm no plaintext token appears anywhere in committed files

---

## Phase 4: US2 — Uptime Monitoring

> Create reproducible setup script for BetterStack uptime monitors.

- [ ] T009 [US2] Create `scripts/setup-betterstack.ts`: idempotent script that calls BetterStack Uptime API (`POST /api/v2/monitors`) to create two monitors — `FitHub API` → `https://api.fithub.space/api/status` (1-min interval, keyword check: `"status":"ok"`) and `FitHub Auth` → `https://auth.fithub.space` (1-min interval, expect 200); supports `--dry-run` flag that prints intended calls without executing; reads `BETTER_STACK_UPTIME_TOKEN` from env
- [ ] T010 [US2] Run `BETTER_STACK_UPTIME_TOKEN=<token> npx tsx scripts/setup-betterstack.ts --dry-run` to validate output, then run without `--dry-run`; confirm both monitors appear in BetterStack Uptime dashboard and show green status within 2 minutes of healthy deploy (AC3, AC4)

---

## Phase 5: US3 — Error Rate Alerting

> Configure BetterStack alert policy for elevated error rates.

- [ ] T011 [US3] In BetterStack Logs dashboard for `fithub-dev` (and `fithub-prod`) source: create alert — query `level = "error"`, threshold `> 10 occurrences in 1 minute`, notification channel = email/Slack; document the exact alert configuration in `docs/runbook.md` so it can be recreated for new environments (AC5); note: BetterStack Logs alert creation is not yet available via API, so this is a manual UI step

---

## Phase 6: US4 — Developer Log Querying

> Confirm BetterStack search capabilities cover developer debugging needs.

- [ ] T012 [US4] In BetterStack Logs, verify the following queries return correct results against real log entries from T006: `userId:"<test-uuid>"` → returns entries for that user; `correlationId:"<id>"` → traces a full request; `event:status.queried` → returns the specific event; `service:"api"` → filters to API Worker only; `level:error` → returns only error-level entries (AC2)

---

## Phase 7: Polish & Closure

- [ ] T013 Create `docs/runbook.md` covering: (a) log search queries cheat-sheet (`userId`, `correlationId`, `event`, `service`, `level:error`), (b) how to acknowledge/silence an alert, (c) incident escalation steps, (d) note on BetterStack data handling (third-party log storage, 30-day retention), (e) how to onboard a new environment (set secret + deploy + run setup script) (AC7, AC9)
- [ ] T014 Mark T053 as `[X]` in `.specify/specs/000-backend-foundation/tasks.md` (closes NFR-6 and Constitution §8 compliance gate)
- [ ] T015 [P] Verify all acceptance criteria AC1–AC9 against the deployed dev environment; update spec.md Status from `Draft` to `Implemented`

---

## Task Dependency Graph

```
T001 (SST secret declared)
  │
  ├──► T002 (Tail Worker impl)
  │       │
  │       ├──► T005 [P] (unit tests — parallel, same files)
  │       │
  │       └──► T003 (TailWorker resource in SST)
  │               │
  │               └──► T004 (tailConsumers on 5 Workers)
  │                       │
  │                       └──► T006 (deploy + smoke test) ──► T007 ──► T008 [P]
  │                                                             │
  │                       ┌────────────────────────────────────┘
  │                       │
  ├──► T009 (setup script) ──► T010 (run monitors)
  │
  └──► T011 (alert policy — manual, parallel with T009/T010)

T010 + T011 + T012 ──► T013 (runbook) ──► T014 (close T053) ──► T015 (AC checklist)
```

---

## Quick Reference Checklist

**Phase 1 — Setup**
- [ ] T001 SST secret declaration

**Phase 2 — Foundational**
- [ ] T002 Tail Worker implementation
- [ ] T003 TailWorker SST resource
- [ ] T004 tailConsumers on 5 Workers
- [ ] T005 Unit tests

**Phase 3 — US1: Log Shipping**
- [ ] T006 Deploy + smoke test
- [ ] T007 Field audit
- [ ] T008 Secret hygiene check

**Phase 4 — US2: Uptime Monitoring**
- [ ] T009 Setup script
- [ ] T010 Run monitors

**Phase 5 — US3: Error Rate Alerting**
- [ ] T011 Alert policy

**Phase 6 — US4: Developer Log Querying**
- [ ] T012 Query verification

**Phase 7 — Polish**
- [ ] T013 Runbook
- [ ] T014 Close T053
- [ ] T015 AC1–AC9 verification

---

## Implementation Strategy

**MVP Scope (US1 only):** T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008

Completing US1 alone satisfies AC1, AC2, AC6, AC8 and makes logs immediately searchable in BetterStack. US2–US4 and the polish phase can follow in any order once US1 is green.

**Suggested delivery order:**
1. US1 (T001–T008) — log shipping live
2. US2 (T009–T010) + US3 (T011) in parallel — monitoring and alerting
3. US4 (T012) — verify queryability against real data
4. Polish (T013–T015) — runbook + T053 closure

---

## Related Documents

- **Feature Spec:** `.specify/specs/007-betterstack-observability/spec.md`
- **Implementation Plan:** `.specify/specs/007-betterstack-observability/plan.md`
- **Research:** `.specify/specs/007-betterstack-observability/research.md`
- **Data Model:** `.specify/specs/007-betterstack-observability/data-model.md`
- **Contracts:** `.specify/specs/007-betterstack-observability/contracts/tail-worker-contract.md`
- **Quickstart:** `.specify/specs/007-betterstack-observability/quickstart.md`
- **Constitution:** `.specify/memory/constitution.md`
- **Closes:** `.specify/specs/000-backend-foundation/tasks.md` T053
