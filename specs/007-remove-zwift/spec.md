# Feature Specification: Remove Zwift Integration

**Feature Name:** Remove Zwift Integration

**Feature ID:** feat-007-remove-zwift

**Version:** 1.0.0

**Status:** Complete — implemented in commit `91d88ca` (2026-05-07)

**Authored By:** FitHub Team

**Date:** 2026-05-07

---

## Problem Statement

**What problem does this feature solve?**

FitHub currently ships a Zwift integration that cannot work in practice. Zwift does not offer a public OAuth API for third-party developers. All unofficial community workarounds rely on reverse-engineered mobile app credentials, which are fragile, undocumented, and in violation of Zwift's terms of service. Attempting to use these approaches risks account bans and can break without warning when Zwift rotates credentials.

The presence of this dead integration creates confusion, introduces unnecessary secrets to manage, and inflates the codebase with untestable code paths.

**Why now?**

The CI/CD pipeline has just been established (feat-006). Before the first real deployment, removing the non-functional Zwift integration ensures the platform launches clean — with only working integrations — and avoids having to explain Zwift's absence to users while still shipping a half-baked connector.

---

## Proposed Solution

**What is the feature?**

Remove all Zwift-specific code, configuration, secrets, tests, and user-facing references from the FitHub platform. The platform will support Strava exclusively as its initial fitness platform integration. The removal should be clean and complete — no Zwift stubs, no commented-out code, no placeholder UI.

**User Stories**

```
As a developer maintaining FitHub,
I want Zwift code and secrets removed from the codebase,
so that I don't waste time managing dead integrations or misleading other developers.
```

```
As a FitHub user,
I want to see only working platform integrations in the app,
so that I am not confused by options that don't function.
```

**Acceptance Criteria**

- [x] AC-1: The Zwift OAuth adapter and all associated source files are deleted from the codebase
- [x] AC-2: All Zwift-specific test files and test cases are removed
- [x] AC-3: No Zwift references remain in route handlers, worker logic, scheduler, or database schema
- [x] AC-4: The web frontend shows no Zwift platform options, labels, or formatting rules (includes pages: `dashboard.astro`, `index.astro`, `privacy.astro`, `ConnectionCard.astro`, `SyncHistoryRow.astro`)
- [x] AC-5: `ZWIFT_CLIENT_ID` and `ZWIFT_CLIENT_SECRET` are removed from all documentation, setup guides, and secret management scripts
- [x] AC-6: `sst.config.ts` contains no Zwift secret bindings
- [x] AC-7: The full test suite passes after removal with no regressions
- [x] AC-8: Coverage thresholds (≥80% lines and branches) continue to pass after removal — 92.89% lines / 87.93% branches (backend); 95.8% lines / 92% branches (web). AC-8 is the measurable gate for AC-7.

---

## Constitution Alignment Checklist

### ✅ Data Privacy & Security
- [x] No new data collection introduced
- [x] Zwift OAuth tokens (if any exist in storage) are not silently retained — removal of the integration implies no new tokens are created; existing stored tokens are inert
- **Notes:** This feature reduces the secret surface area, improving security posture.

### ⚠️ Cross-Platform Integration — DEVIATION DOCUMENTED
- [x] Removal is complete — no partial stubs or dead adapters left behind
- [x] Strava integration is unaffected
- **Notes:** Constitution P2 states FitHub MUST integrate with ≥5 major fitness platforms. After this removal, only Strava is active (1 platform). This deviation is formally acknowledged: Zwift had no viable public OAuth API and was never deployable. The 5-platform target remains a long-term aspirational goal; reaching it requires future platform integration specs (Apple Health, Garmin, Suunto, etc.). The constitution P2 language will be amended to distinguish current-state minimums from long-term aspirational targets. **Approved deviation — core team awareness required per constitution Governance §Compliance.**

### ✅ User Experience & Simplicity
- [x] UI simplified: users see only Strava, no broken or greyed-out Zwift option
- [x] No user-facing error messages about Zwift removal needed (it was never deployed)
- **Notes:** Strava-only UI is simpler and less confusing for early users.

### ✅ Reliability & Uptime
- [x] Removal of dead code paths reduces surface area for runtime errors
- **Notes:** No reliability concerns — this is a reduction, not an addition.

### ⚠️ Performance & Real-Time Sync — NOT APPLICABLE
- **Notes:** No sync paths are introduced; one is removed. Performance is unchanged or marginally improved.

### ✅ Code Quality & Testing
- [x] Unit test coverage must remain ≥80% after removal (AC-8)
- [x] No test files reference Zwift after completion
- [x] Linting and type-checking must pass with no new errors
- **Notes:** Removing the Zwift adapter and its tests simultaneously keeps coverage ratios stable.

### ✅ Transparency & Communication
- [x] No user-facing communication required (Zwift was never in a released version)
- [x] Internal documentation (specs, quickstart guides) updated to reflect Strava-only
- **Notes:** Historical spec `002-zwift-oauth` preserved for reference.

### ✅ Functional & Structured Logging
- [x] No new log events introduced
- [x] Zwift-specific log event names removed from codebase
- **Notes:** Any log entries that hardcode `"platform":"zwift"` in tests are removed.

---

## Technical Specification

### Scope

**In Scope:**
- Delete `packages/core/src/adapters/zwift-adapter.ts` and its export from `index.ts`
- Delete `packages/core/test/zwift-adapter.test.ts`
- Remove `"zwift"` platform type from DB schema, API types, route validators, sync logic, scheduler, and worker
- Remove Zwift UI references from the web frontend (platform labels, formatters, mock handlers)
- Remove `ZWIFT_CLIENT_ID` and `ZWIFT_CLIENT_SECRET` from `sst.config.ts` and all documentation
- Update `specs/006-cicd-deploy-pipeline/quickstart.md` and `tasks.md` to reflect 8 SST secrets (not 10)
- Update `README.md` and `mobile/README.md` to remove Zwift mentions

**Out of Scope:**
- Deleting the historical spec `002-zwift-oauth` (preserved for audit trail)
- Any database migrations for existing deployed environments (not yet deployed)
- Re-introducing any Zwift functionality

### Architecture & Components

**Files to delete:**
- `packages/core/src/adapters/zwift-adapter.ts`
- `packages/core/test/zwift-adapter.test.ts`

**Files to update:**
- `packages/core/src/adapters/index.ts` — remove Zwift export
- `packages/core/src/db/schema.ts` — remove `"zwift"` from platform enum
- `packages/core/src/types/api.ts` — remove `"zwift"` from platform union type
- `packages/functions/src/api/routes/connections.ts` — remove Zwift from platform list/validation
- `packages/functions/src/api/routes/activities.ts` — remove Zwift filter handling
- `packages/functions/src/api/routes/sync.ts` — remove Zwift from platform validation
- `packages/functions/src/scheduler/index.ts` — remove Zwift references
- `packages/functions/src/worker/index.ts` — remove Zwift references
- `packages/functions/test/connections.test.ts` — remove Zwift test cases
- `packages/functions/test/activities.test.ts` — remove Zwift test cases
- `packages/functions/test/sync-trigger.test.ts` — remove Zwift test cases
- `web/src/components/SyncNowButton.tsx` — remove Zwift platform option
- `web/src/components/SyncNowButton.test.tsx` — remove Zwift test cases
- `web/src/lib/formatters.ts` — remove Zwift formatting rules
- `web/src/lib/formatters.test.ts` — remove Zwift formatter tests
- `web/src/lib/api-client.ts` — remove Zwift type references
- `web/src/lib/api-client.test.ts` — remove Zwift test cases
- `web/src/mocks/handlers.ts` — remove Zwift mock handlers
- `web/src/components/ConnectionCard.astro` — remove Zwift from platformLabel map
- `web/src/components/SyncHistoryRow.astro` — remove Zwift from platformLabel map
- `web/src/pages/dashboard.astro` — remove Zwift platform filter, "Connect Zwift" CTA, and Zwift type reference
- `web/src/pages/index.astro` — remove Zwift from landing page copy
- `web/src/pages/privacy.astro` — remove Zwift from privacy policy text
- `sst.config.ts` — remove `ZWIFT_CLIENT_ID` and `ZWIFT_CLIENT_SECRET` secret bindings
- `specs/006-cicd-deploy-pipeline/quickstart.md` — update secret count and list
- `specs/006-cicd-deploy-pipeline/tasks.md` — update T012 secret list
- `README.md`, `mobile/README.md` — remove Zwift mentions

### Technical Constraints

- **No regressions:** All existing Strava, auth, and activity flows must continue to work unchanged
- **Coverage:** Post-removal coverage must stay ≥80% on lines and branches
- **Type safety:** TypeScript compilation must pass with no errors after removal

---

## Testing Strategy

**Unit Tests:**
- Verify `createZwiftAdapter` export no longer exists at package boundary
- Verify platform type union no longer includes `"zwift"`

**Regression Tests (existing suite must pass):**
- All Strava adapter tests
- All connection route tests (Strava only)
- All sync trigger tests (Strava only)
- All web component tests

**Manual Verification:**
- [x] `npm run test:coverage` exits 0 with ≥80% coverage — **verified**
- [x] `npm run build` (web) exits 0 — **verified**
- [ ] TypeScript type-check (`npm run typecheck`) passes with no errors — pending explicit task T026

---

## Success Metrics

- **Metric 1:** Zero TypeScript compilation errors after removal
- **Metric 2:** Full test suite passes (exit 0) with ≥80% line and branch coverage
- **Metric 3:** Zero occurrences of the string `"zwift"` in non-spec, non-historical source files (`packages/`, `web/src/`, `sst.config.ts`)

---

## Related Documents

- Constitution: `.specify/memory/constitution.md`
- Historical Zwift spec: `.specify/specs/002-zwift-oauth/spec.md`
- CI/CD pipeline: `specs/006-cicd-deploy-pipeline/spec.md`
- Task Breakdown: `specs/007-remove-zwift/tasks.md`
- Note: `plan.md` was intentionally skipped — scope was fully defined in spec.md and tasks.md was generated directly from the spec.
