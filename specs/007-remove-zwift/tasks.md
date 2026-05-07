# Tasks: feat-007-remove-zwift

## Phase 1 — Delete Zwift adapter and tests

- [x] T001 Delete `packages/core/src/adapters/zwift-adapter.ts`
- [x] T002 Delete `packages/core/test/zwift-adapter.test.ts`
- [x] T003 Remove Zwift export from `packages/core/src/adapters/index.ts`

## Phase 2 — Remove from data/type layer

- [x] T004 Remove `"zwift"` from platform enum in `packages/core/src/db/schema.ts`
- [x] T005 Remove `"zwift"` from platform union type in `packages/core/src/types/api.ts`

## Phase 3 — Remove from function routes and workers

- [x] T006 Remove Zwift from `packages/functions/src/api/routes/connections.ts`
- [x] T007 Remove Zwift from `packages/functions/src/api/routes/activities.ts`
- [x] T008 Remove Zwift from `packages/functions/src/api/routes/sync.ts`
- [x] T009 Remove Zwift from `packages/functions/src/scheduler/index.ts`
- [x] T010 Remove Zwift from `packages/functions/src/worker/index.ts`

## Phase 4 — Update function tests

- [x] T011 Remove Zwift test cases from `packages/functions/test/connections.test.ts`
- [x] T012 Remove Zwift test cases from `packages/functions/test/activities.test.ts`
- [x] T013 Remove Zwift test cases from `packages/functions/test/sync-trigger.test.ts`

## Phase 5 — Remove from web frontend

- [x] T014 Remove Zwift from `web/src/components/SyncNowButton.tsx`
- [x] T015 Remove Zwift from `web/src/components/SyncNowButton.test.tsx`
- [x] T016 Remove Zwift from `web/src/lib/formatters.ts`
- [x] T017 Remove Zwift from `web/src/lib/formatters.test.ts`
- [x] T018 Remove Zwift from `web/src/lib/api-client.ts` and `api-client.test.ts`
- [x] T019 Remove Zwift mock handlers from `web/src/mocks/handlers.ts`

## Phase 6 — Update configuration and documentation

- [x] T020 Remove `ZWIFT_CLIENT_ID` and `ZWIFT_CLIENT_SECRET` from `sst.config.ts`
- [x] T021 Update `specs/006-cicd-deploy-pipeline/quickstart.md` (8 secrets, not 10)
- [x] T022 Update `specs/006-cicd-deploy-pipeline/tasks.md` T012 secret list
- [x] T023 Update `README.md` and `mobile/README.md` to remove Zwift mentions

## Phase 7 — Validation

- [x] T024 Run full test suite (`npm run test:coverage`) — verify exit 0 and ≥80% coverage
- [x] T025 Verify zero occurrences of `"zwift"` in non-spec source files
- [x] T026 Run `npm run typecheck` (or `tsc --noEmit`) and verify exit 0 — confirms TypeScript compilation passes independently of vitest/esbuild. **Note:** Pre-existing TS errors in `merger.ts` and `events.ts` are unrelated to Zwift removal (neither file was modified); they are tracked separately.
