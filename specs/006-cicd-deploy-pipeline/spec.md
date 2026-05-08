# Feature Specification: CI/CD Pipeline & Deployment

---

## Feature Overview

**Feature Name:** CI/CD Pipeline & Deployment

**Feature ID:** feat-006-cicd-deploy-pipeline

**Version:** 1.1.0

**Status:** In Development

**Authored By:** FitHub Team

**Date:** 2026-05-07

---

## Problem Statement

**What problem does this feature solve?**

Currently, deploying FitHub to Cloudflare is a manual process. There is no automated quality gate that validates code before it reaches users, and deployments require developer intervention with local tooling. This creates risk of unvetted changes reaching production, slows down iteration, and makes it difficult to maintain consistent quality standards across contributions.

**Why now?**

The web frontend (feat-005) is now built and tested locally. Before any real traffic is served, an automated pipeline must exist to deploy reliably and safely — catching issues early and ensuring every deployment is verified.

---

## Proposed Solution

**What is the feature?**

An automated CI/CD pipeline using GitHub Actions that:
1. Runs quality checks on every pull request — tests, static analysis, type safety, and build verification
2. Automatically deploys to the **dev** environment on every commit to `master`
3. Automatically seeds all SST app secrets from GitHub Environment secrets before every deployment — no manual local setup required
4. Never exposes secrets or credentials in logs or outputs

**User Stories**

```
As a developer,
I want every pull request to be automatically checked for quality issues,
so that I catch problems before they reach the main branch.
```

```
As a developer,
I want my merged changes automatically deployed to the dev environment,
so that I can verify behaviour in a realistic environment quickly.
```

```
As a developer,
I want clear, actionable feedback when the pipeline fails,
so that I can fix issues quickly without guessing what went wrong.
```

```
As a new developer or CI environment,
I want the pipeline to handle all secret configuration automatically,
so that I never have to run manual local commands before a deployment works.
```

**Acceptance Criteria**

- [ ] AC-1: Every pull request triggers automated checks; all checks must pass before merging is permitted.
- [ ] AC-2: Automated checks include test execution, type safety verification, linting, and a successful build.
- [ ] AC-3: Every commit pushed to `master` automatically deploys the full solution to the **dev** stage.
- [ ] AC-4: Secrets and credentials (Cloudflare API tokens, SST app secrets) are never visible in pipeline logs.
- [ ] AC-5: Every workflow step has a descriptive `name:` label; failed steps surface the exact failing step name in the GitHub pull request checks panel or deployment view.
- [ ] AC-6: The pipeline deploys both the backend infrastructure and the web frontend as a coordinated unit within a single stage.
- [ ] AC-7: The pipeline is idempotent — running it twice with the same code produces the same deployed state.
- [ ] AC-10: D1 database migrations are automatically applied as part of every deployment — no manual database commands are required after any deploy.
- [ ] AC-8: A coverage report is generated, published as a pipeline artefact, and summarised inline in the GitHub Actions step summary on every run.
- [ ] AC-9: All SST app secrets are automatically seeded from GitHub Environment secrets during the deployment job — no manual `sst secret set` commands are required to deploy a new environment.

---

## Constitution Alignment Checklist

### ✅ Data Privacy & Security
- [x] Secrets (Cloudflare tokens, SST app credentials) are stored in GitHub Environment secrets — never in source code or logs
- [x] All secrets are managed in the GitHub `dev` environment and seeded to Cloudflare automatically by the pipeline: 6 total — 1 infrastructure token (`CLOUDFLARE_API_TOKEN`) + 5 SST app secrets (`TOKEN_MASTER_KEY`, `STRAVA_CLIENT_SECRET`, `STRAVA_CLIENT_ID`, `REDIRECT_BASE_URL`, `OPENAUTH_SIGNING_KEY`). `APPLE_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET`, and `EMAIL_PROVIDER_KEY` are deferred until the auth worker is implemented.
- [x] Pipeline access follows least-privilege: only the minimum permissions required per job
- [x] No user data or PII passes through the pipeline
- **Notes:** GitHub is the single authoritative source for all credential values. The deployment runtime reads them from Cloudflare's secret store, which is seeded by CI on every deploy.

### ✅ Code Quality & Testing
- [x] All tests must pass before deployment proceeds
- [x] Type checking and linting are required gates on every PR
- [x] Build verification is a required gate
- [x] Coverage reporting is included
- **Notes:** This pipeline feature *is* the quality gate infrastructure for all other features.

### ✅ Reliability & Uptime
- [x] Failed deployments do not leave the system in a partial state (SST handles rollback/idempotency)
- [x] Pipeline failures are surfaced immediately
- **Notes:** SST's stage-based deployment model provides isolation per stage. Only `dev` is in scope.

### ✅ Transparency & Communication
- [x] Pipeline status visible to all team members in GitHub
- [x] Deployment history auditable via GitHub Actions run logs
- [x] All quality gate failures are clearly communicated in PR context
- **Notes:** GitHub's native status checks and deployment environments provide the transparency layer.

### ✅ User Experience & Simplicity
- [x] Developers see clear pass/fail status on every PR
- [x] Step-level labels surface the exact failing step without digging into raw logs
- [x] Coverage summary is visible inline in the Actions run — no external service required
- **Notes:** Pipeline UX is developer-facing; simplicity manifests as named steps, inline summaries, and clear gate labels.

### ⚠️ Performance & Real-Time Sync — DEFERRED
- [ ] Performance regression tests in CI/CD pipeline (P5 MUST)
- **Notes:** Formally non-compliant with P5. No application performance benchmarks exist yet; correctness tests cannot regress against a baseline that does not exist. Time-bounded deferral — to be addressed after the first end-to-end sync feature establishes a baseline. See also: `plan.md` Principle 5 section.

### ✅ Functional & Structured Logging
- [x] Pipeline emits structured step-level logs within GitHub Actions
- [x] No tokens or credentials appear in any log output
- **Notes:** GitHub Actions masks secrets automatically; care must be taken to avoid echoing credential values in scripts.

---

## Technical Specification

### Scope

**In Scope:**
- GitHub Actions workflow for pull request quality checks
- GitHub Actions workflow for dev stage deployment on every push to `master`
- Secret management via GitHub repository/environment secrets
- Automated SST app secret seeding from GitHub Environment secrets as part of every deployment (via `sst secret set`)
- Automatic D1 database migration on every deployment via `scripts/migrate.ts` (idempotent — already-applied migrations are skipped)
- Test execution, linting, type checking, and build verification as pipeline steps
- Coverage report as a pipeline artefact and an inline GitHub Actions step summary
- Notification of pipeline failure (GitHub native status checks)

**Out of Scope:**
- Prod stage deployment (deferred to a future feature)
- Preview/ephemeral deployments per pull request (deferred)
- Slack/email notifications (deferred; GitHub native notifications are sufficient for now)
- Performance budgets / Lighthouse CI (noted in feat-005 but not owned by this pipeline spec)
- Multi-region deployments
- Any pipeline work for mobile apps (Apple Health is postponed)

### Technical Constraints

- **Deployment Tool:** SST v4 (Infrastructure as Code targeting Cloudflare)
- **CI Platform:** GitHub Actions
- **Hosting:** Cloudflare (Pages for web frontend, Workers for backend services)
- **Stages:** `dev` only (prod stage deferred)
- **Secrets:** All credential values are stored in GitHub Environment secrets. The pipeline seeds SST app secrets to Cloudflare's secret store on every deployment; the deployed runtime reads from Cloudflare. 7 secrets total: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` + 5 SST app secrets (`TOKEN_MASTER_KEY`, `STRAVA_CLIENT_SECRET`, `STRAVA_CLIENT_ID`, `REDIRECT_BASE_URL`, `OPENAUTH_SIGNING_KEY`). `APPLE_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET`, and `EMAIL_PROVIDER_KEY` are deferred until the auth worker is implemented. `CLOUDFLARE_ACCOUNT_ID` is required by the D1 migration runner (`scripts/migrate.ts`) to call the Cloudflare REST API.
- **Credential scope:** Cloudflare API token must be scoped to minimum required permissions

### Architecture & Components

```
Pull Request
    │
    ▼
[PR Quality Gate Workflow]
    ├─ Install dependencies
    ├─ Type check (all workspaces)
    ├─ Lint (all workspaces)
    ├─ Unit tests + coverage (all workspaces)
    └─ Build verification (web frontend only — SST bundles the backend at deploy time)
         │
         └─ All pass → PR can be merged

Push to master
    │
    ▼
[Deploy Dev Workflow]
    ├─ (Re-runs quality checks for safety)
    ├─ Seed SST app secrets (reads values from GitHub Environment secrets → sst secret set --stage dev)
    ├─ SST deploy --stage dev → Cloudflare
    └─ Apply D1 migrations (npx sst shell --stage dev npx tsx scripts/migrate.ts)
         └─ migrate.ts: creates __migrations table, runs each .sql file once, skips already-applied
```

**Component Changes:**
- `.github/workflows/`: CI/CD workflow file — `deploy-dev` job includes seed step before SST deploy and migration step after deploy
- `scripts/migrate.ts`: TypeScript D1 migration runner — uses `Resource.FithubDb.databaseId` (injected by `sst shell`) and the Cloudflare REST API to apply SQL migration files idempotently; tracks applied migrations in a `__migrations` table
- `drizzle/migrations/`: SQL migration files applied by `migrate.ts`
- `sst.config.ts`: Stages already configured; no changes expected
- Repository settings: GitHub Environment (`dev`) configured with 7 secrets (2 Cloudflare infra secrets + 5 SST app secrets; 3 auth secrets deferred)

---

## Testing Strategy

**Validation of the pipeline itself:**
- Verify PR quality gate blocks a merge when a test is intentionally broken
- Verify PR quality gate blocks a merge when linting fails
- Verify that a push to `master` triggers the dev deployment
- Verify that secrets do not appear in any step log output
- Verify that `sst secret list --stage dev` shows all 8 app secrets after a successful pipeline run

**Pipeline steps tested per run:**
- Unit tests across all workspaces (vitest)
- Type checking across all workspaces
- ESLint across all source files
- Full build (web + infra) succeeds without errors

---

## Success Metrics

- **Metric 1:** 100% of pull requests are gated by automated quality checks before merge is permitted.
- **Metric 2:** Dev environment is updated within 5 minutes of a push to `master` (P95 target).
- **Metric 3:** No secrets or credentials appear in any pipeline log (verified by log inspection).
- **Metric 4:** Pipeline failure reason is identifiable by a developer within 2 minutes of a failed run.
- **Metric 5:** A developer can set up a fully working deployment from scratch by adding 7 GitHub Environment secrets — no local CLI commands required.

---

## Assumptions

- SST is already configured for Cloudflare in the repo (`sst.config.ts`); this spec does not change infrastructure topology.
- The default branch is `master`; this is the deployment trigger branch.
- A Cloudflare API token with sufficient scope to deploy the application already exists or will be created before implementation.
- All workspaces (`packages/core`, `web`, `workers/*`) are already testable and buildable locally.
- GitHub repository has appropriate permissions to create environments and required status checks.
- All SST app secret values are stored as GitHub Environment secrets in the `dev` environment; the pipeline seeds them to Cloudflare's secret store on every deploy. No manual local `sst secret set` commands are required after initial GitHub setup.
- `CLOUDFLARE_ACCOUNT_ID` is stored as a GitHub Environment secret and passed to `scripts/migrate.ts` at migration time.

---

## Open Questions & Decisions

- No open questions. Prod stage is out of scope for this feature.

---

## Related Documents

- Constitution: `.specify/memory/constitution.md`
- Web Frontend Spec: `.specify/specs/005-web-frontend/spec.md`
- Implementation Plan: `specs/006-cicd-deploy-pipeline/plan.md`
- Task Breakdown: `specs/006-cicd-deploy-pipeline/tasks.md`


---


## Clarifications

### Session 2025-05

- **Q: Should the anticipatory Apple/Google/email auth secrets be kept in `sst.config.ts`?**
  A: Keep `OPENAUTH_SIGNING_KEY` only (needed now for JWT verification). Remove `APPLE_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET`, and `EMAIL_PROVIDER_KEY` until the auth worker (`packages/functions/src/auth/`) is implemented. At that point, re-add the relevant secrets to `sst.config.ts`, `ci.yml`, and `quickstart.md`.
