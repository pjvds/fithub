# Feature Specification Template

Use this template for all feature specifications in FitHub. Ensure alignment with the project constitution at `.specify/memory/constitution.md`.

---

## Feature Overview

**Feature Name:** Sync History

**Feature ID:** feat-009-sync-history

**Version:** 1.0.0

**Status:** Draft

**Authored By:** Copilot

**Date:** 2025-07-14

---

## Problem Statement

**What problem does this feature solve?**

Users who trigger a Strava sync have no way to know whether the sync succeeded, how many activities were imported, or whether any errors occurred. The sync operation currently runs silently in the background with no visible outcome — users must manually check Strava and FitHub's activity list to infer what happened. This lack of feedback erodes trust in the platform.

**Why now?**

The Strava integration was just completed and syncs are actively being triggered by users. Without visible sync history, users cannot diagnose failures, understand the scope of imported data, or feel confident their data is up-to-date. This is the minimum viable feedback loop required for a trustworthy data sync product.

---

## Proposed Solution

**What is the feature?**

A sync history tracking system that records every sync job, captures its outcome, and presents results to users in real-time and historically. Users see a live status indicator while a sync is in progress and can review a paginated list of past sync jobs — including status, activities synced count, timestamps, and any error messages.

**User Stories**

```
As a connected Strava user,
I want to see whether my last sync succeeded and how many activities were imported,
so that I know my FitHub data is up-to-date.
```

```
As a connected Strava user,
I want to see a live indicator while a sync is running,
so that I know the system is actively working and haven't already completed.
```

```
As a connected Strava user,
I want to review a history of past syncs with error messages for failed ones,
so that I can understand what went wrong and decide whether to retry.
```

```
As a connected Strava user,
I want to see the last time a successful sync completed on my dashboard,
so that I can quickly assess data freshness without navigating to the history page.
```

**Acceptance Criteria**

- [ ] When a sync is triggered, a job record is created immediately with `pending` status.
- [ ] While a job is `pending`, a live status banner or indicator is visible on the dashboard.
- [ ] When a sync completes successfully, the job status updates to `success` and the activity count is recorded.
- [ ] When a sync fails, the job status updates to `failed` and the error message is recorded.
- [ ] The dashboard connection card shows "Last synced: [relative time]" reflecting the most recent successful sync.
- [ ] A sync history page lists all past jobs for the user, ordered newest-first, with status, activity count, start time, and error (if any).
- [ ] The history list supports pagination (cursor-based) to handle large histories.
- [ ] Sync history is scoped to the authenticated user — no cross-user data leakage.
- [ ] All sync job data persists across server restarts and page reloads.

---

## Constitution Alignment Checklist

### ✅ Data Privacy & Security
- [x] User data is encrypted at rest (AES-256 minimum)
- [x] Data transmission uses TLS 1.3+
- [x] User consent is explicit and revocable
- [x] Third-party integrations vetted for security
- **Notes:** Sync job records are stored in D1 (Cloudflare-managed SQLite), encrypted at rest. All API calls use HTTPS. Sync history is user-scoped with auth middleware enforcing identity. No raw Strava tokens or payloads are stored in sync_jobs records.

### ✅ Cross-Platform Integration
- [x] Adapter/integration follows platform-specific API requirements
- [x] Rate limits and retry logic implemented
- [x] Conflict detection logic defined (if applicable)
- [x] Platform-specific data normalization documented
- **Notes:** This feature is platform-agnostic at the data model layer — `sync_jobs` has a `platform` column. Only Strava is implemented at v1 (documented P2 deviation). Retry logic exists in the queue worker; each retry attempt creates a new job record for traceability.

### ✅ User Experience & Simplicity
- [x] Onboarding/setup completable in <5 minutes
- [x] Error messages are clear and actionable (not technical jargon)
- [x] Advanced options hidden by default
- [x] Fewer than 3 taps/clicks for core action
- **Notes:** Sync history is surfaced automatically — no configuration required. Error messages shown to users are human-readable summaries, not raw exception text. The live status banner appears automatically when a sync is running.

### ✅ Reliability & Uptime
- [x] Offline scenarios handled (queueing, retries)
- [x] Failed operations retry with exponential backoff
- [x] Data persistence survives app restart/reboot
- [x] Monitoring/alerting requirements defined
- **Notes:** Sync jobs are persisted in D1 immediately on trigger. The live indicator polls every 60 seconds with no persistent client-side state — page reload will resume polling. Failed jobs persist with error messages so users can review them later.

### ✅ Performance & Real-Time Sync
- [x] Latency targets defined (target <5 min P95)
- [x] Caching strategy documented
- [x] Batching/optimization approach defined
- [x] Performance regression testing planned
- **Notes:** Job records are written and queried via indexed D1 queries (by user_id + started_at DESC). Polling interval is 60 seconds — acceptable for background sync visibility. No additional caching needed given query simplicity.

### ✅ Code Quality & Testing
- [x] Unit test coverage target ≥80%
- [x] Integration test scenarios identified
- [x] E2E test plan defined
- [x] Code review process enforced in PR
- [x] Static analysis (linting, type-checking) requirements listed
- **Notes:** New routes and DB helpers are type-checked via `npm run typecheck`. Existing test suite (128 tests) must continue to pass after implementation.

### ✅ Transparency & Communication
- [x] User-facing documentation/help text planned
- [x] Privacy/data handling implications documented
- [x] Known limitations or caveats identified
- [x] Release notes content drafted
- **Notes:** Known limitation: the live banner polls every 60s, so job completion may be visible up to 60s after the fact. Sync jobs are retained indefinitely (no expiry policy yet — out of scope for v1).

### ✅ Functional & Structured Logging
- [x] Functional events emitted by this feature are listed
- [x] All log entries are JSON-structured with timestamp, level, service, env, correlation/request ID, userId
- [x] No tokens, raw third-party payloads, or PII beyond `userId` appear in logs
- [x] `error`-level logs carry typed error codes for alerting/aggregation
- [x] Audit-relevant events write to audit_log
- **Notes:** Events: `sync.job.created`, `sync.job.completed`, `sync.job.failed`. Error log entries include `job_id`, `user_id`, `platform`, `error_code`. No Strava tokens or raw API payloads logged. Job lifecycle events are sufficient audit trail for sync operations.

---

## Technical Specification

### Scope

**In Scope:**
- `sync_jobs` database table with columns: `id`, `user_id`, `connection_id`, `platform`, `status` (pending/success/partial/failed), `source` (manual/scheduled), `activities_synced`, `error_message`, `started_at`, `ended_at`
- INSERT on sync trigger (status=pending)
- UPDATE on worker completion (success or failed)
- `GET /api/sync/history` — paginated cursor-based query returning job list
- `POST /api/sync/trigger` — returns the created job ID in addition to queue confirmation
- Dashboard connection card: "Last synced: [relative time]" from most recent successful job
- Live status banner polling every 60s to detect pending jobs

**Out of Scope:**
- Retry-on-failure initiated from the history UI (manual retry button — future feature)
- Push notifications when a sync completes
- Sync job expiry / data retention policy
- Per-activity-level sync logs (only job-level metadata)
- Scheduled sync automation (separate feature)

### Technical Constraints

- **Platform Compatibility:** Web only (Astro SSR + React islands)
- **API/Service Dependencies:** Cloudflare D1 (SQLite), Cloudflare Queue Worker
- **Data Format/Schema Changes:** New `sync_jobs` table; `connections` table unchanged; user profile endpoint extended with `last_synced_at` derived field
- **Performance Requirements:** History query returns in <200ms for users with up to 1,000 jobs (indexed by user_id)
- **Security/Compliance:** All history queries enforce `userId` from verified JWT — no query parameter override possible

### Architecture & Components

```
[Browser]
  |-- POST /api/sync/trigger (Astro proxy)
  |     └─→ POST /api/sync/trigger (Api Worker)
  |           ├─→ INSERT sync_jobs (status=pending)
  |           └─→ Enqueue message → Queue
  |
  |-- GET /api/sync/history (Astro proxy, polled every 60s)
  |     └─→ GET /api/sync/history (Api Worker)
  |           └─→ SELECT sync_jobs WHERE user_id = ? ORDER BY started_at DESC
  |
[Queue Worker]
  |-- process message
  |     ├─→ Strava API fetch activities
  |     ├─→ INSERT activities
  |     └─→ UPDATE sync_jobs SET status=success|failed, ended_at, activities_synced|error_message
```

**Component Changes:**
- `packages/core/src/db/schema.ts`: Add `syncJobs` Drizzle table definition
- `drizzle/migrations/0002_add_sync_jobs.sql`: DDL migration
- `packages/functions/src/api/routes/sync.ts`: History queries DB; trigger INSERTs row
- `packages/functions/src/worker/index.ts`: UPDATEs job on completion/failure
- `packages/functions/src/api/routes/user.ts`: `last_synced_at` derived from most recent success job

---

## Testing Strategy

**Unit Tests:**
- History route returns empty list for user with no jobs
- History route returns jobs ordered newest-first
- History route enforces cursor pagination correctly
- Trigger route returns `job_id` in response body
- User profile `last_synced_at` returns null when no successful jobs exist
- User profile `last_synced_at` returns timestamp of most recent success (not failed) job

**Integration Tests:**
- Full trigger → worker → history cycle: trigger creates pending job; worker updates to success; history returns it
- Failed sync: worker updates job to `failed` with error message; history shows it; `last_synced_at` not updated

**End-to-End Tests:**
- User triggers sync via dashboard button → live banner appears within 60s → banner disappears after completion → history page shows job
- "Last synced" on dashboard updates after a successful sync

**Manual Testing Checklist:**
- [ ] Trigger sync → see pending indicator on dashboard
- [ ] Wait for sync to complete → indicator disappears, history shows job with activity count
- [ ] Check "Last synced" timestamp on connection card
- [ ] Navigate to history page → jobs listed newest-first with correct status badges
- [ ] Trigger sync that fails → history shows failed status with error message

---

## Success Metrics

- **Metric 1:** Users can see sync job status within 60 seconds of job state change (polling interval)
- **Metric 2:** History page loads all jobs for a user with up to 1,000 records in under 200ms
- **Metric 3:** Zero cross-user data leakage in history or profile endpoints (verified by auth middleware tests)
- **Metric 4:** Sync job persistence: 100% of triggered jobs appear in history after page reload

---

## Open Questions & Decisions

- **Question 1:** Should partial syncs (some activities failed, some succeeded) be represented as a distinct `partial` status or collapsed into `success` with a note?
  - **Resolution:** `partial` status is modeled in the schema and returned in the API. UI renders it as a warning badge. Detailed per-activity errors are out of scope for v1.

- **Question 2:** How long should sync job history be retained?
  - **Resolution:** Indefinite retention in v1. A data retention/expiry policy is a future concern, not blocking this feature.

---

## Related Documents

- Constitution: `.specify/memory/constitution.md`
- Implementation Plan: `.specify/specs/009-sync-history/plan.md` (once created)
- Task Breakdown: `.specify/specs/009-sync-history/tasks.md` (once created)
