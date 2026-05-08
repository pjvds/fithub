# Task Breakdown: BetterStack Observability

**Feature:** BetterStack Observability

**Feature ID:** feat-007-betterstack-observability

**Plan Reference:** `.specify/specs/007-betterstack-observability/plan.md`

**Breakdown Date:** 2026-05-08 (revised: Logpush via Pulumi, no uptime monitors)

**Breakdown Author:** Copilot

**Status:** Draft

---

## User Stories

| ID  | Story |
|-----|-------|
| US1 | As an **operator**, I want all FitHub Worker logs shipped to BetterStack, so that I can search, filter, and alert on structured log events beyond Cloudflare's 1-hour window. |
| US3 | As an **operator**, I want to be alerted when the error rate rises above a threshold, so that I can investigate problems before users report them. |
| US4 | As a **developer**, I want to query logs by `userId`, `correlationId`, or `event` code, so that I can trace the full lifecycle of a sync job or auth event for debugging. |

---

## Phase 1: SST — Enable Logpush on All Workers

- [x] T001 Add `logpush: true` to all 5 Workers in `sst.config.ts`; add `BetterStackToken` SST Secret + `cloudflare.LogpushJob` Pulumi resource (managed by `sst deploy`)

---

## Phase 2: US1 — Log Shipping Verification

- [ ] T002 [US1] Deploy to dev stage (`sst deploy`); trigger `GET /api/status` and confirm a structured log entry appears in BetterStack Logs within 60 seconds (AC1)
- [ ] T003 [US1] Audit BetterStack log entries from T002: verify `event`, `level`, `service`, `userId`, `correlationId` fields are present and queryable (AC2); verify no email, token, or raw payload visible (AC6)
- [ ] T004 [P] [US1] Verify AC8: confirm no plaintext BetterStack token appears in committed files

---

## Phase 3: US3 — Error Rate Alerting

- [ ] T005 [US3] In BetterStack Logs dashboard: create alert — query `level = "error"`, threshold `> 10 occurrences in 1 minute`, notification channel = email/Slack (AC5); manual UI step

---

## Phase 4: US4 — Developer Log Querying

- [ ] T006 [US4] Verify queries against real entries from T002: `userId:"<uuid>"`, `correlationId:"<id>"`, `event:status.queried`, `service:"api"`, `level:error` (AC2)

---

## Phase 5: Polish & Closure

- [ ] T007 Mark T053 as `[X]` in `.specify/specs/000-backend-foundation/tasks.md`
- [ ] T008 [P] Verify acceptance criteria AC1–AC6, AC8 against deployed dev; update spec.md Status from `Draft` to `Implemented`

---

## Task Dependency Graph

```
T001 (done) ──► T002 (deploy + smoke test) ──► T003 ──► T004 [P]
                                                │
T005 (alert policy — parallel) ────────────────┤
T006 (query verification — after T002) ─────────┤
                                                ▼
                                          T007 ──► T008
```

---

## Quick Reference Checklist

- [x] T001 logpush: true on all 5 Workers + Pulumi LogpushJob + secret
- [ ] T002 Deploy + smoke test
- [ ] T003 Field audit
- [ ] T004 Secret hygiene check
- [ ] T005 Alert policy
- [ ] T006 Query verification
- [ ] T007 Close T053
- [ ] T008 AC checklist

---

## Related Documents

- **Feature Spec:** `.specify/specs/007-betterstack-observability/spec.md`
- **Implementation Plan:** `.specify/specs/007-betterstack-observability/plan.md`
- **Research:** `.specify/specs/007-betterstack-observability/research.md`
- **Quickstart:** `.specify/specs/007-betterstack-observability/quickstart.md`
- **Closes:** `.specify/specs/000-backend-foundation/tasks.md` T053
