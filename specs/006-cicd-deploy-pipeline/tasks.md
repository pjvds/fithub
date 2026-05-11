# Task Breakdown: CI/CD Pipeline & Deployment

**Feature:** CI/CD Pipeline & Deployment

**Feature ID:** feat-006-cicd-deploy-pipeline

**Plan Reference:** `specs/006-cicd-deploy-pipeline/plan.md`

**Breakdown Date:** 2026-05-07

**Status:** Partially Complete — 15/16 tasks done; T015 (branch protection) pending

---

## Task Summary

**Total Tasks:** 16

**Critical Path:** Phase 1 → Phase 2 → Phase 3 → Phase 4 (sequential; each phase depends on previous)

**Number of Parallel Work Streams:** 1 (this feature is a single workflow file; phases within Phase 2 and 3 have limited parallelism)

**Priority Tasks:**
1. T001 — Coverage dependency (blocks all test/coverage steps)
2. T002 — Rename job (structural change required before adding new steps)
3. T008 — Deploy job (the core Phase 2 deliverable)

---

## User Stories

- **US1**: As a developer, I want every PR automatically checked for quality issues so that I catch problems before they reach main.
- **US2**: As a developer, I want my merged changes automatically deployed to dev so I can verify behaviour quickly.
- **US3**: As a developer, I want clear, actionable feedback when the pipeline fails so I can fix issues quickly.

---

## Phase 1: Setup

*Prerequisites for all subsequent work. No story label.*

- [x] T001 Install `@vitest/coverage-v8` as a root devDependency in `package.json` and add `--coverage.thresholds.lines=80 --coverage.thresholds.branches=80` to the `test:coverage` script in `package.json` so the step fails if coverage drops below the P6 constitutional minimum
- [x] T002 Rename the `build` job to `quality` in `.github/workflows/ci.yml` and add a descriptive `name:` label to every existing unnamed `run:` step (e.g. "Backend: lint", "Backend: typecheck", "Web: Astro check") to satisfy AC-5 and US3

---

## Phase 2: Quality Gate Hardening [US1]

*Extends the existing quality job with coverage reporting and build verification. Satisfies AC-1, AC-2, AC-8.*

- [x] T003 [US1] Replace `npm test` with `npm test -- --coverage` in the quality job to generate backend/shared package coverage in `.github/workflows/ci.yml`
- [x] T004 [US1] Replace `npm -w @fithub/web run test` with `npm -w @fithub/web run test:coverage` in the quality job for web coverage in `.github/workflows/ci.yml`
- [x] T005 [P] [US1] Add `actions/upload-artifact@v4` step to upload the merged coverage report from `coverage/` as a pipeline artefact in `.github/workflows/ci.yml`
- [x] T006 [P] [US1] Add a step that writes the coverage summary to `$GITHUB_STEP_SUMMARY` so coverage is visible inline on every Actions run in `.github/workflows/ci.yml`
- [x] T007 [US1] Add `npm -w @fithub/web run build` as a required build verification step at the end of the quality job in `.github/workflows/ci.yml`

---

## Phase 3: Automated Dev Deployment [US2]

*Adds the `deploy-dev` job. Satisfies AC-3, AC-4, AC-6, AC-7.*

- [x] T008 [US2] Add a `deploy-dev` job to `.github/workflows/ci.yml` with `needs: quality` and `if: github.ref == 'refs/heads/master' && github.event_name == 'push'` so it only runs on push to master, never on PRs
- [x] T009 [US2] Set `environment: dev` on the `deploy-dev` job in `.github/workflows/ci.yml` to isolate the Cloudflare API token to the GitHub Environment secret store
- [x] T010 [US2] Add `npm ci` and `npx sst deploy --stage dev` steps to the `deploy-dev` job, using `CLOUDFLARE_API_TOKEN` from the environment secret in `.github/workflows/ci.yml`

---

## Phase 4: Operational Setup & Validation

*One-time infrastructure setup and end-to-end validation. No story label.*

- [x] T011 Create the GitHub Environment named `dev` in repository Settings → Environments and add the `CLOUDFLARE_API_TOKEN` secret (see `specs/006-cicd-deploy-pipeline/quickstart.md` for required token permissions)
- [x] T012 Pre-seed all 8 SST app secrets for the dev stage via `sst secret set <name> <value> --stage dev` (TOKEN_MASTER_KEY, STRAVA_CLIENT_SECRET, STRAVA_CLIENT_ID, REDIRECT_BASE_URL, OPENAUTH_SIGNING_KEY, APPLE_CLIENT_SECRET, GOOGLE_CLIENT_SECRET, EMAIL_PROVIDER_KEY)
- [x] T013 Validate the PR quality gate: push a branch with an intentional failing test and verify the `quality` job fails and blocks merge
- [x] T014 Validate the deploy pipeline: merge a valid PR to master and verify the `deploy-dev` job runs, deploys successfully within 5 minutes, no secrets appear in any step log, and running `sst deploy --stage dev` a second time exits cleanly without destructive changes (idempotency — AC-7)
- [ ] T015 Configure branch protection on `master` in GitHub repository Settings → Branches: require the `quality` status check to pass before merge is permitted, so AC-1 is structurally enforced (not just aspirational)
- [x] T016 Verify coverage threshold enforcement: push a branch that intentionally drops line coverage below 80% and confirm the `quality` job fails at the test step, not silently

---

## Task Dependency Graph

```
T001 (coverage dep + threshold)
  └── T003 [US1] backend coverage
  └── T004 [US1] web coverage
        └── T005 [US1] upload artifact  ─┐ parallel
        └── T006 [US1] step summary     ─┘
  └── T007 [US1] build verification

T002 (rename job + step labels)
  └── (all Phase 2 + 3 tasks reference this named job)

[Phase 2 complete] ──────────────────────────────────┐
                                                      ↓
T008 [US2] deploy-dev job structure
  └── T009 [US2] environment: dev
        └── T010 [US2] npm ci + sst deploy step
              └── T011 GitHub Environment + secret
                    └── T012 SST app secrets
                          ├── T013 validate quality gate
                          │     └── T015 branch protection
                          ├── T014 validate deploy (idempotency)
                          └── T016 verify coverage threshold enforcement
```

---

## Parallel Execution Opportunities

- **T005 + T006** are independent steps that can be added to the workflow in parallel (different steps, both append to the job; no ordering dependency between them)
- **T003 + T004** can be authored simultaneously (different workspaces, different workflow steps), though both modify `ci.yml` so apply sequentially to avoid conflicts

---

## Independent Test Criteria Per Story

| Story | Done When |
|---|---|
| US1 | A PR with a failing test is blocked; a PR with passing tests shows a green quality check and a downloadable coverage artifact |
| US2 | A push to master, after the quality job passes, automatically triggers deployment to Cloudflare dev stage within 5 minutes |
| US3 | Each step in the workflow has a meaningful `name:` label; a broken pipeline surfaces the exact failing step in the PR checks panel |

---

## MVP Scope

**Minimum viable pipeline:** US1 (quality gate) only — T001 through T007, plus T016 (coverage threshold validation).

This is independently valuable: every PR is gated, coverage is tracked and enforced, and build failures are caught early. US2 (deploy) requires T011/T012 operational prerequisites; it can follow after US1 is verified working. T015 (branch protection) should be configured as soon as the first passing pipeline run is confirmed.

---

## Related Documents

- **Feature Specification:** `specs/006-cicd-deploy-pipeline/spec.md`
- **Implementation Plan:** `specs/006-cicd-deploy-pipeline/plan.md`
- **Quickstart (setup guide):** `specs/006-cicd-deploy-pipeline/quickstart.md`
- **Research:** `specs/006-cicd-deploy-pipeline/research.md`
- **Constitution:** `.specify/memory/constitution.md`
