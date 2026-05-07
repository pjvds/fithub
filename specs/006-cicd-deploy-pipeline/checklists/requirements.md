# Requirements Checklist — 006-cicd-deploy-pipeline

Use this checklist to validate the spec before handing off to speckit-plan.

---

## Functional Requirements

- [x] FR-1: PR quality gate workflow defined (tests, lint, type check, build)
- [x] FR-2: Dev stage auto-deployment on every push to `master`
- [x] FR-3: Secrets managed via GitHub Secrets — never in source code or logs
- [x] FR-4: Pipeline status visible in GitHub PR and deployment view
- [x] FR-5: Coverage report published as pipeline artefact or PR comment
- [x] FR-6: Web frontend + backend deployed as a coordinated unit per stage

## Non-Functional Requirements

- [x] NFR-1: Pipeline idempotent — same code = same deployed state
- [x] NFR-2: Dev environment updated within 5 minutes of push to `master`
- [x] NFR-3: No secrets/credentials visible in any log output
- [x] NFR-4: Pipeline failure reason identifiable within 2 minutes

## Constitution Compliance

- [x] CONST-1: Credentials use least-privilege (Data Privacy & Security)
- [x] CONST-2: All tests pass before deployment (Code Quality & Testing)
- [x] CONST-3: Failed deployments do not leave partial state (Reliability)
- [x] CONST-4: Deployment history auditable in GitHub (Transparency)
- [x] CONST-5: No credentials in logs (Functional & Structured Logging)

## Open Issues

None.

---

**Status:** READY FOR speckit-plan
