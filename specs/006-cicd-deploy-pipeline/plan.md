# Implementation Plan: CI/CD Pipeline & Deployment

**Feature:** CI/CD Pipeline & Deployment (Reference: `specs/006-cicd-deploy-pipeline/spec.md`)

**Plan ID:** plan-feat-006-cicd-deploy-pipeline

**Version:** 1.0.0

**Planned By:** FitHub Team

**Date:** 2026-05-07

---

## Problem & Approach

**Feature Problem:**
Deploying FitHub to Cloudflare is fully manual. There are no automated quality gates blocking low-quality code from merging, and no automated delivery to a live environment after a commit lands.

**Implementation Approach:**
Extend the existing GitHub Actions `ci.yml` workflow with:
1. A hardened quality gate job (add build verification + coverage reporting to what already exists)
2. A `deploy-dev` job that runs **only on push to `master`**, depends on the quality gate passing, and runs `sst deploy --stage dev` against Cloudflare using a single `CLOUDFLARE_API_TOKEN` secret

No new infrastructure is introduced. SST app secrets (`TOKEN_MASTER_KEY`, OAuth credentials, etc.) are pre-seeded via `sst secret set` and live in Cloudflare — they do not pass through GitHub Actions. Only the Cloudflare API token needs to be stored as a GitHub Actions secret.

---

## Design Decisions & Rationale

**Decision 1: Single workflow file with a conditional deploy job**
- **Choice:** Add a `deploy-dev` job to the existing `ci.yml` rather than creating a separate workflow file
- **Rationale:** The deploy job has a natural `needs: quality` dependency. Using one file makes the flow readable and avoids duplication of the setup steps. The deploy job is conditionally gated with `if: github.ref == 'refs/heads/master' && github.event_name == 'push'` so it never runs on PRs.
- **Constitution Alignment:** Simplicity (Principle 3) — one file is easier to maintain and understand
- **Alternatives Considered:** Separate `deploy-dev.yml` triggered by `workflow_run` completion — adds indirection and potential race conditions
- **Impact:** Minimal; modifies only `.github/workflows/ci.yml`

**Decision 2: Only `CLOUDFLARE_API_TOKEN` stored in GitHub Secrets**
- **Choice:** SST app secrets (`TOKEN_MASTER_KEY`, `ZWIFT_CLIENT_SECRET`, etc.) are pre-seeded via `sst secret set` and stored inside Cloudflare, not in GitHub. Only the Cloudflare API token needs to live in GitHub.
- **Rationale:** SST v4 retrieves secrets at deploy/runtime from its own secret store. Copying all secrets into GitHub doubles the secret management surface area and risks drift. One secret is simpler and safer.
- **Constitution Alignment:** Data Privacy & Security (Principle 1) — minimal secret exposure
- **Alternatives Considered:** All secrets in GitHub environment → unnecessary duplication
- **Impact:** Operator must run `sst secret set <name> <value> --stage dev` once per secret before first deploy

**Decision 3: Coverage reported as GitHub Actions step summary + artifact**
- **Choice:** Run `vitest run --coverage` (v8 provider) and upload the coverage output as an Actions artifact; print summary to `$GITHUB_STEP_SUMMARY`
- **Rationale:** Avoids requiring a third-party service (Codecov, Coveralls) for a pre-launch project. GitHub-native artifacts are free and immediately accessible.
- **Constitution Alignment:** Code Quality & Testing (Principle 6) — coverage is visible on every run
- **Alternatives Considered:** Codecov integration — adds dependency on external service; overkill at this stage
- **Impact:** Adds `@vitest/coverage-v8` devDependency to root workspace

**Decision 4: Build verification included in quality gate**
- **Choice:** Run `astro build` (web) as a required quality gate step, not just `astro check`
- **Rationale:** Type checking and linting pass on code that fails to build. Build verification catches bundler-level errors early on every PR.
- **Constitution Alignment:** Code Quality & Testing (Principle 6)
- **Alternatives Considered:** Build-only-on-deploy — errors would be caught too late, failing the deploy job
- **Impact:** Adds ~30s to PR CI time; worth the earlier signal

---

## Architecture & Component Changes

```
GitHub Actions Runner
├── Job: quality  (runs on push to master + all PRs)
│   ├── npm ci
│   ├── npm run lint             (eslint, all workspaces)
│   ├── npm run typecheck        (tsc --noEmit, backend packages)
│   ├── npm -w @fithub/web run check    (astro check)
│   ├── npm -w @fithub/web run typecheck
│   ├── npm -w @fithub/web run lint
│   ├── npm test --coverage      (vitest, all workspaces)
│   ├── npm -w @fithub/web run test:coverage
│   ├── Upload coverage artifact
│   ├── npm -w @fithub/web run build    (astro build — build verification)
│   └── Write coverage summary → $GITHUB_STEP_SUMMARY
│
└── Job: deploy-dev  (only on push to master, needs: quality)
    ├── npm ci
    ├── npx sst deploy --stage dev
    └── (uses CLOUDFLARE_API_TOKEN from GitHub Environment 'dev')
```

**New Components:**
- Updated `.github/workflows/ci.yml`: adds coverage steps and `deploy-dev` job

**Modified Components:**
- `package.json` (root): ensure `test:coverage` script exists with `--coverage` flag
- `web/package.json`: already has `test:coverage` script

**No removed components.**

---

## Technical Details

### Data Model & Schema

This feature introduces no new database entities, schema migrations, or data model changes. The pipeline operates entirely at the infrastructure and tooling layer.

### API/Interface Changes

This feature introduces no new API endpoints and does not modify existing ones.

### Integration Points

**External Services:**
- **Cloudflare** (via SST): Deployment target. Authentication via `CLOUDFLARE_API_TOKEN`. Token must have "Edit" permissions for Workers, Pages, D1, KV, R2, and Queues in the target account.
- **GitHub Actions**: CI/CD runtime. Uses `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`.

**Internal Dependencies:**
- `sst.config.ts`: Already configured for Cloudflare; no changes needed
- All workspaces must have `test:coverage` scripts available

---

## Constitution Compliance by Principle

### 1. Data Privacy & Security
**Compliance Strategy:**
- [x] Only `CLOUDFLARE_API_TOKEN` stored in GitHub — all app secrets live in SST/Cloudflare secret store
- [x] Token scoped to minimum required Cloudflare permissions
- [x] No user data passes through the pipeline at any point
- [x] GitHub Environment `dev` isolates the deploy secret from the quality gate job

**Deviations:** None.

### 2. Cross-Platform Integration
Not applicable — this feature does not integrate with fitness platforms.

### 3. User Experience & Simplicity
**Compliance Strategy:**
- [x] Developers see clear pass/fail status on every PR
- [x] Error messages from GitHub Actions steps are surfaced directly in the PR checks panel

**Deviations:** None.

### 4. Reliability & Uptime
**Compliance Strategy:**
- [x] SST's Cloudflare provider is idempotent — re-running deploy produces the same state
- [x] Failed deploys do not affect the currently running deployment (Cloudflare atomic deployment model)
- [x] Quality gate failure blocks deployment — partial/untested builds never reach `dev`

**Deviations:** None.

### 5. Performance & Real-Time Sync
**Compliance Strategy:**
- [ ] Performance regression tests in CI/CD — **DEFERRED**: no application performance benchmarks exist yet; the current test suite covers correctness only. A minimal benchmark suite (e.g., `vitest bench` on critical sync paths) will be added in a follow-up feature once baseline metrics are established.

**Deviations:** Formal non-compliance with P5 MUST. Accepted as a time-bounded deferral: performance benchmarks cannot meaningfully regress against a baseline that does not yet exist. To be addressed after first end-to-end sync feature is complete.

### 6. Code Quality & Testing
**Compliance Strategy:**
- [x] All PRs gated by lint, type check, unit tests, and build
- [x] Coverage reported on every run
- [x] Static analysis (eslint, tsc) required to pass before merge

**Deviations:** None.

### 7. Transparency & Communication
**Compliance Strategy:**
- [x] All pipeline runs visible in GitHub Actions tab
- [x] Deployment history visible in GitHub Environments panel
- [x] Coverage summary posted to step summary on every run

**Deviations:** None.

### 8. Functional & Structured Logging
**Compliance Strategy:**
- [x] GitHub Actions produces structured step-level logs
- [x] Secrets masked by GitHub Actions (`::add-mask::`) — never appear in logs
- [x] No tokens or PII are echoed in any pipeline script

**Deviations:** None.

---

## Implementation Breakdown

**Phase 1: Coverage & Build Verification in Quality Gate**
- Add `@vitest/coverage-v8` to root devDependencies
- Extend `ci.yml` quality job: replace `npm test` with `npm test -- --coverage`, add web coverage step
- Add `actions/upload-artifact` step to publish coverage report
- Add build verification step: `npm -w @fithub/web run build`
- Deliverables: quality gate produces coverage artifact on every run; build errors caught on PRs
- Dependencies: none (existing workflow already runs)

**Phase 2: Deploy Job**
- Add `deploy-dev` job to `ci.yml` with `needs: quality` and `if: github.ref == 'refs/heads/master' && github.event_name == 'push'`
- Configure `environment: dev` on the deploy job (links to GitHub Environment for secrets)
- Add `npx sst deploy --stage dev` step using `CLOUDFLARE_API_TOKEN` from environment secrets
- Deliverables: every push to master triggers an automated deploy to Cloudflare dev stage
- Dependencies: Phase 1 complete; `CLOUDFLARE_API_TOKEN` GitHub secret and `dev` environment configured

**Phase 3: GitHub Environment Setup (One-time ops)**
- Create GitHub Environment `dev` in repository settings
- Add `CLOUDFLARE_API_TOKEN` secret to the `dev` environment
- Pre-seed all SST app secrets via `sst secret set <name> <value> --stage dev` (one-time per secret)
- Deliverables: pipeline can deploy successfully end-to-end
- Dependencies: Phase 2 workflow file merged

---

## Dependencies & Blockers

**External Dependencies:**
- [ ] `CLOUDFLARE_API_TOKEN` with correct permissions must be created in the Cloudflare dashboard
- [ ] SST app secrets must be seeded via `sst secret set` before first deploy succeeds

**No blocking technical issues identified.**

---

## Risk Management

**Risk 1: SST app secrets not pre-seeded before first deploy**
- **Likelihood:** High (one-time setup step easily missed)
- **Impact:** Medium (deploy succeeds but app is misconfigured at runtime)
- **Mitigation:** Document all required secrets in `quickstart.md`; deploy job can be re-run after seeding

**Risk 2: Cloudflare API token with insufficient permissions**
- **Likelihood:** Medium
- **Impact:** High (deploy fails at the Cloudflare provider step)
- **Mitigation:** Document exact required token permissions in `quickstart.md`

**Risk 3: Web build step adds significant CI time**
- **Likelihood:** Low (Astro builds are fast, ~30s)
- **Impact:** Low
- **Mitigation:** Cache node_modules with `actions/setup-node` cache; already configured

---

## Testing & Validation Strategy

**Unit Testing:** No new application code — no unit tests required for this feature.

**Integration Testing (pipeline validation):**
- [ ] Push a PR with an intentional lint error → quality job must fail at lint step
- [ ] Push a PR with a failing test → quality job must fail at test step
- [ ] Push a valid PR → all quality checks pass; `deploy-dev` does NOT run (PR, not push to master)
- [ ] Merge a valid PR to master → `deploy-dev` runs and deploys successfully to Cloudflare dev
- [ ] Verify no secrets appear in any step log output
- [ ] Verify coverage artifact is available for download after a successful run

**Manual Testing Checklist:**
- [ ] Coverage report is readable and reflects actual test coverage
- [ ] GitHub PR checks panel shows all individual job steps (not just aggregate)
- [ ] GitHub Environments panel shows deployment history for `dev`
- [ ] Running `sst deploy --stage dev` locally matches the deployed state

---

## Rollout & Rollback Plan

**Deployment Strategy:** The pipeline itself is deployed by merging to master. No special rollout procedure.

**Rollback Trigger:** If the deploy job causes unexpected outages (should not, given Cloudflare's atomic deployment model), revert the offending commit on master and the next push will redeploy the previous state.

**Monitoring Post-Deployment:** GitHub Actions run history serves as the audit trail. No additional monitoring infrastructure required.

---

## Success Criteria

**Feature is complete when:**
- [x] All acceptance criteria from spec are met (AC-1 through AC-8)
- [x] Quality gate blocks a PR with a broken test
- [x] Push to master triggers an automated deploy to Cloudflare dev
- [x] Coverage artifact is published on every run
- [x] Secrets are never visible in pipeline logs
- [x] Quickstart documents all one-time setup steps

---

## Open Questions & Decisions

All questions resolved. See `specs/006-cicd-deploy-pipeline/spec.md` for decisions log.

---

## Related Documents

- **Feature Specification:** `specs/006-cicd-deploy-pipeline/spec.md`
- **Constitution:** `.specify/memory/constitution.md`
- **Task Breakdown:** `specs/006-cicd-deploy-pipeline/tasks.md` (to be created by speckit-tasks)
- **Quickstart:** `specs/006-cicd-deploy-pipeline/quickstart.md`
- **Research:** `specs/006-cicd-deploy-pipeline/research.md`


---

## Plan Overview

**Feature:** [FEATURE_NAME] (Reference: `[SPEC_FILE_PATH]`)

**Plan ID:** [plan-FEATURE_ID]

**Version:** 1.0.0

**Planned By:** [NAME]

**Date:** [YYYY-MM-DD]

**Target Start:** [YYYY-MM-DD]

**Target Completion:** [YYYY-MM-DD]

---

## Problem & Approach

**Feature Problem:**
[Concise restatement of the problem the feature solves. Reference spec.]

**Implementation Approach:**
[High-level strategy for solving this problem. What's the architecture? What are the key design decisions?]

---

## Design Decisions & Rationale

Document major technical and architectural choices made during planning. Each decision should trace back to the constitution.

**Decision 1: [Title]**
- **Choice:** [What was decided]
- **Rationale:** [Why this choice]
- **Constitution Alignment:** [Which principle(s) does this uphold? Data Privacy? Performance? Code Quality?]
- **Alternatives Considered:** [Why not X or Y?]
- **Impact:** [Scope, complexity, dependencies]

**Decision 2: [Title]**
- **Choice:** [What was decided]
- **Rationale:** [Why this choice]
- **Constitution Alignment:** [Which principle(s)?]
- **Alternatives Considered:** [Why not X or Y?]
- **Impact:** [Scope, complexity, dependencies]

---

## Architecture & Component Changes

**System Diagram:**
[ASCII diagram or reference to external architecture document.]

```
[Diagram showing how components interact for this feature]
```

**New Components:**
- [Component Name]: [Purpose, responsibilities]
- [Component Name]: [Purpose, responsibilities]

**Modified Components:**
- [Existing Component]: [What changes? Why?]
- [Existing Component]: [What changes? Why?]

**Removed/Deprecated Components:**
- [If any]: [Decommissioning plan]

---

## Technical Details

### Data Model & Schema

**New Entities:**
```
[Entity Name]
  - field1: type (description)
  - field2: type (description)
  - relationships: [Links to other entities]
```

**Schema Migrations:**
- [Migration 1]: [From → To, rationale]
- [Migration 2]: [From → To, rationale]

**Data Privacy Considerations:**
- Encryption requirements: [AES-256, TLS 1.3, etc.]
- Retention policy: [How long data is stored]
- User consent: [What data collection requires explicit user approval]

### API/Interface Changes

**New Endpoints (if applicable):**
- `POST /api/v1/sync/[resource]` — [Purpose, payload, response]
- `GET /api/v1/sync/[resource]/status` — [Purpose, payload, response]

**Modified Endpoints:**
- `PATCH /api/v1/[resource]` — [What changed and why]

**Internal Service Interfaces:**
- [Service A] → [Service B]: [New or modified contract]

### Integration Points

**External Services:**
- [Platform Name] API: [What data exchanged? Rate limits? Authentication?]
- [Platform Name] API: [What data exchanged? Rate limits? Authentication?]

**Internal Dependencies:**
- [Service/Component]: [Dependency type, version requirements]
- [Service/Component]: [Dependency type, version requirements]

---

## Constitution Compliance by Principle

Review this plan against each principle. Document compliance strategy or deviations requiring approval.

### 1. Data Privacy & Security
**Compliance Strategy:**
- [ ] Encryption: [Details on at-rest and in-transit encryption]
- [ ] Access Control: [How is user data isolated?]
- [ ] Audit Trail: [What logging occurs for compliance?]
- [ ] Vendor Assessment: [New third-party services vetted?]

**Deviations (if any):** [If this feature deviates from principle, explain why and what approval is needed]

### 2. Cross-Platform Integration
**Compliance Strategy:**
- [ ] Adapter Pattern: [How does this feature normalize platform-specific data?]
- [ ] Conflict Handling: [How are duplicates detected/resolved?]
- [ ] Rate Limiting: [How do we respect API rate limits?]
- [ ] Error Handling: [Retry logic and graceful degradation]

**Deviations (if any):** [If this feature deviates from principle, explain why and what approval is needed]

### 3. User Experience & Simplicity
**Compliance Strategy:**
- [ ] Setup Flow: [Can a user complete this in <5 minutes? Explain.]
- [ ] Error Messaging: [Non-technical user guidance defined]
- [ ] Progressive Disclosure: [Advanced options hidden by default?]
- [ ] Accessibility: [WCAG compliance, keyboard navigation, etc.]

**Deviations (if any):** [If this feature deviates from principle, explain why and what approval is needed]

### 4. Reliability & Uptime
**Compliance Strategy:**
- [ ] Offline Support: [How are operations queued offline?]
- [ ] Retry Logic: [Exponential backoff, max attempts, timeout]
- [ ] Data Persistence: [Survives app restart/device reboot?]
- [ ] Monitoring: [SLA targets, alerting thresholds, dashboards]
- [ ] Incident Response: [Playbooks for common failures]

**Deviations (if any):** [If this feature deviates from principle, explain why and what approval is needed]

### 5. Performance & Real-Time Sync
**Compliance Strategy:**
- [ ] Latency Targets: [P95, P99 latency goals per operation]
- [ ] Throughput: [Expected operations/second, scaling plan]
- [ ] Caching: [Cache-invalidation strategy, TTLs]
- [ ] Batching: [Grouping strategy to reduce API calls]
- [ ] Monitoring: [Performance metrics, regression detection]

**Deviations (if any):** [If this feature deviates from principle, explain why and what approval is needed]

### 6. Code Quality & Testing
**Compliance Strategy:**
- [ ] Test Coverage: [Target ≥80% unit test coverage for new code]
- [ ] Integration Tests: [Happy-path and error scenarios]
- [ ] E2E Tests: [Full-stack validation scenarios]
- [ ] Code Review: [Who reviews? What's the acceptance criteria?]
- [ ] Static Analysis: [Linting, type-checking tools to enforce]
- [ ] Dependency Management: [Update/patch strategy]

**Deviations (if any):** [If this feature deviates from principle, explain why and what approval is needed]

### 7. Transparency & Communication
**Compliance Strategy:**
- [ ] User Documentation: [In-app help, tutorials, FAQs]
- [ ] Data Handling: [Privacy policy updates, user consent flows]
- [ ] Known Issues: [Documented limitations or edge cases]
- [ ] Release Notes: [Changelog entry, user-facing description]
- [ ] Status Monitoring: [Status page updates for platform availability]

**Deviations (if any):** [If this feature deviates from principle, explain why and what approval is needed]

### 8. Functional & Structured Logging
**Compliance Strategy:**
- [ ] Event Vocabulary: [List of functional events this feature emits, e.g. `activity.synced`, `connection.refresh.failed`]
- [ ] Required Fields: [Confirm timestamp, level, service, env, correlation/request ID, userId are emitted]
- [ ] Sensitive-Data Review: [Confirm tokens, raw payloads, and PII beyond `userId` are NOT logged]
- [ ] Error Codes: [Typed error codes/identifiers attached to `error`-level entries]
- [ ] Correlation: [How are correlation IDs propagated across queues/workers/external calls?]
- [ ] Audit vs. Operational: [Which events also require an audit_log entry?]

**Deviations (if any):** [If this feature deviates from principle, explain why and what approval is needed]

---

## Implementation Breakdown

**Phase 1: Foundation [Week 1-2]**
- [Task 1]: [Brief description]
- [Task 2]: [Brief description]
- Deliverables: [What's ready after Phase 1?]
- Dependencies: [What must be done first?]

**Phase 2: Core Implementation [Week 3-4]**
- [Task 1]: [Brief description]
- [Task 2]: [Brief description]
- Deliverables: [What's ready after Phase 2?]
- Dependencies: [What must be done first?]

**Phase 3: Testing & Polish [Week 5]**
- [Task 1]: [Brief description]
- [Task 2]: [Brief description]
- Deliverables: [What's ready after Phase 3?]
- Dependencies: [What must be done first?]

**Phase 4: Security Review & Deployment [Week 6]**
- [Task 1]: [Security audit]
- [Task 2]: [Performance testing]
- [Task 3]: [Staging validation]
- Deliverables: [Ready for production]

---

## Dependencies & Blockers

**Critical Path:**
[List the sequence of tasks that determines the minimum timeline.]

**External Dependencies:**
- [ ] Dependency 1: [Description, owner, ETA]
- [ ] Dependency 2: [Description, owner, ETA]
- [ ] Blocker 1: [Known issue, resolution needed before proceeding]

---

## Risk Management

**Risk 1: [Risk Title]**
- **Likelihood:** [High/Medium/Low]
- **Impact:** [High/Medium/Low]
- **Mitigation:** [Proactive action to reduce likelihood or impact]

**Risk 2: [Risk Title]**
- **Likelihood:** [High/Medium/Low]
- **Impact:** [High/Medium/Low]
- **Mitigation:** [Proactive action to reduce likelihood or impact]

---

## Testing & Validation Strategy

**Unit Testing:**
[Describe scope of unit tests. Target ≥80% coverage.]

**Integration Testing:**
[Testing between components. Focus on seams and data flow.]

**E2E Testing:**
[Full-stack scenarios. Identify 2-3 critical paths to validate.]

**Security Testing:**
[Penetration testing, data exposure risks, authentication/authorization validation.]

**Performance Testing:**
[Load testing, latency profiling, resource usage monitoring.]

**Manual Testing Checklist:**
- [ ] Test scenario 1
- [ ] Test scenario 2
- [ ] Test scenario 3

---

## Rollout & Rollback Plan

**Deployment Strategy:**
[Phased rollout? Feature flags? Canary deployment?]

**Rollback Trigger:**
[Conditions that warrant rolling back. How quickly can we revert?]

**Monitoring Post-Deployment:**
[Metrics to watch, alert thresholds, who owns the alert?]

---

## Success Criteria

**Feature is complete when:**
- [ ] All acceptance criteria from spec are met
- [ ] ≥80% unit test coverage achieved
- [ ] Security audit passed
- [ ] Performance targets met (latency <5 min P95)
- [ ] Code review approved
- [ ] User documentation complete
- [ ] Integration testing validated
- [ ] Staging deployment stable for 48 hours

---

## Resource Allocation

**Team:**
- [Role]: [Name, % allocation, dates]
- [Role]: [Name, % allocation, dates]

**Skills Required:**
- [Skill]: [Why needed, critical/nice-to-have]

---

## Open Questions & Decisions

- **Question 1:** [Description]
  - **Status:** [Resolved / Pending]
  - **Resolution:** [Decision or next step]

- **Question 2:** [Description]
  - **Status:** [Resolved / Pending]
  - **Resolution:** [Decision or next step]

---

## Approval & Sign-Off

- [ ] Architecture Review: ______________________ Date: _______
- [ ] Security Review: _________________________ Date: _______
- [ ] Lead Engineer: ___________________________ Date: _______
- [ ] Ready to breakdown into tasks: __________ Date: _______

---

## Related Documents

- **Feature Specification:** [Link to spec.md]
- **Constitution:** `.specify/memory/constitution.md`
- **Task Breakdown:** [Link to tasks.md, once created]
- **Project Intent:** `docs/project-intent.md`
