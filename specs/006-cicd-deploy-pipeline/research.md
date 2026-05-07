# Research Notes: feat-006-cicd-deploy-pipeline

## Overview

This document captures research findings and technology decisions made during the planning phase for the CI/CD pipeline feature.

---

## Decision 1: Single workflow file vs. separate files

**Question:** Should the CI quality gate and the deployment be in the same workflow file or separate files?

**Finding:** GitHub Actions supports both patterns. Separate workflow files connected via `workflow_run` events are useful when workflows are independently maintained by different teams or have very different trigger rules. For a small monorepo where quality and deployment are tightly coupled (deploy should never run without quality passing), a single file with a `needs:` dependency between jobs is simpler and avoids the indirection of `workflow_run`.

**Decision:** Single `ci.yml` with a conditional `deploy-dev` job gated by `needs: quality`.

**Rationale:** Fewer files, clearer dependency chain, easier to reason about.

---

## Decision 2: Which secrets go in GitHub vs. SST

**Question:** Should all SST secrets (TOKEN_MASTER_KEY, ZWIFT_CLIENT_SECRET, etc.) be stored in GitHub Secrets in addition to SST's secret store?

**Finding:** SST v4 stores secrets in the Cloudflare environment (via Cloudflare Worker secrets or similar). At deploy time, SST reads these from the Cloudflare account — they are NOT passed through the CI runner. The only credential needed in the GitHub pipeline is a Cloudflare API token so SST can authenticate to the Cloudflare API.

**Decision:** Only `CLOUDFLARE_API_TOKEN` in GitHub Secrets. All app secrets remain in SST/Cloudflare.

**Rationale:** Eliminates secret duplication; reduces GitHub secret surface area; prevents drift between GitHub and Cloudflare values.

---

## Decision 3: Coverage tooling

**Question:** Which coverage provider to use with Vitest? Codecov/Coveralls integration or GitHub-native?

**Finding:** Vitest supports `@vitest/coverage-v8` (fast, uses V8 native coverage) and `@vitest/coverage-istanbul`. For a pre-launch project, using `actions/upload-artifact` to publish the coverage report and `$GITHUB_STEP_SUMMARY` for inline summaries requires zero external services and zero configuration.

**Decision:** `@vitest/coverage-v8` + artifact upload + step summary. Codecov can be added later if PR comment integration becomes desirable.

**Rationale:** Zero external dependencies; works immediately; coverage visible in every run.

---

## Decision 4: Cloudflare API token permissions

**Question:** What permissions does the Cloudflare API token need for SST to deploy?

**Finding:** SST v4 with Cloudflare provider provisions: Workers, D1 databases, KV namespaces, R2 buckets, Queues, and Pages (for the web frontend). The API token needs:
- `Workers Scripts:Edit`
- `Workers KV Storage:Edit`
- `Workers R2 Storage:Edit`
- `Workers D1:Edit`
- `Cloudflare Pages:Edit`
- `Account Settings:Read` (for account ID lookup)

**Decision:** Document all required permissions in `quickstart.md`.

---

## Decision 5: Node.js version

**Question:** Which Node.js version should the pipeline use?

**Finding:** The existing `ci.yml` already specifies `node-version: 20`. The web workspace and backend packages are tested on Node 20. No change required.

**Decision:** Node 20 (LTS), consistent with existing setup.

---

## Alternatives Considered and Rejected

| Alternative | Reason Rejected |
|---|---|
| `workflow_run` trigger for deploy | Adds indirection; race conditions possible |
| All secrets in GitHub | Doubles secret management surface; drift risk |
| Codecov for coverage | External service dependency; unnecessary at pre-launch stage |
| Tag-based prod deployment | Out of scope; prod stage deferred |
| Preview deployments per PR | Out of scope; deferred to future feature |
