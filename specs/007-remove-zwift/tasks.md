# Tasks: feat-007-remove-zwift

## Phase 1 — Delete Zwift adapter and tests

- [ ] T001 Delete `packages/core/src/adapters/zwift-adapter.ts`
- [ ] T002 Delete `packages/core/test/zwift-adapter.test.ts`
- [ ] T003 Remove Zwift export from `packages/core/src/adapters/index.ts`

## Phase 2 — Remove from data/type layer

- [ ] T004 Remove `"zwift"` from platform enum in `packages/core/src/db/schema.ts`
- [ ] T005 Remove `"zwift"` from platform union type in `packages/core/src/types/api.ts`

## Phase 3 — Remove from function routes and workers

- [ ] T006 Remove Zwift from `packages/functions/src/api/routes/connections.ts`
- [ ] T007 Remove Zwift from `packages/functions/src/api/routes/activities.ts`
- [ ] T008 Remove Zwift from `packages/functions/src/api/routes/sync.ts`
- [ ] T009 Remove Zwift from `packages/functions/src/scheduler/index.ts`
- [ ] T010 Remove Zwift from `packages/functions/src/worker/index.ts`

## Phase 4 — Update function tests

- [ ] T011 Remove Zwift test cases from `packages/functions/test/connections.test.ts`
- [ ] T012 Remove Zwift test cases from `packages/functions/test/activities.test.ts`
- [ ] T013 Remove Zwift test cases from `packages/functions/test/sync-trigger.test.ts`

## Phase 5 — Remove from web frontend

- [ ] T014 Remove Zwift from `web/src/components/SyncNowButton.tsx`
- [ ] T015 Remove Zwift from `web/src/components/SyncNowButton.test.tsx`
- [ ] T016 Remove Zwift from `web/src/lib/formatters.ts`
- [ ] T017 Remove Zwift from `web/src/lib/formatters.test.ts`
- [ ] T018 Remove Zwift from `web/src/lib/api-client.ts` and `api-client.test.ts`
- [ ] T019 Remove Zwift mock handlers from `web/src/mocks/handlers.ts`

## Phase 6 — Update configuration and documentation

- [ ] T020 Remove `ZWIFT_CLIENT_ID` and `ZWIFT_CLIENT_SECRET` from `sst.config.ts`
- [ ] T021 Update `specs/006-cicd-deploy-pipeline/quickstart.md` (8 secrets, not 10)
- [ ] T022 Update `specs/006-cicd-deploy-pipeline/tasks.md` T012 secret list
- [ ] T023 Update `README.md` and `mobile/README.md` to remove Zwift mentions

## Phase 7 — Validation

- [ ] T024 Run full test suite (`npm run test:coverage`) — verify exit 0 and ≥80% coverage
- [ ] T025 Verify zero occurrences of `"zwift"` in non-spec source files
