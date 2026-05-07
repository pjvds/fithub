<!--
SYNC IMPACT REPORT
Version: 1.0.0 → 1.1.0 (MINOR: new principle added)
Date: 2026-05-06
Impact: Added Principle 8 — Functional & Structured Logging.
- Added principle: 8. Functional & Structured Logging
- Renumbered: none (appended at end)
- Removed: none
- Templates updated:
  - ✅ .specify/templates/plan-template.md (added Principle 8 compliance section)
  - ✅ .specify/templates/spec-template.md (added Principle 8 alignment checklist; updated principle count 7 → 8)
  - ✅ .specify/memory/architecture-overview.md (updated principle count reference 7 → 8)
- Templates not requiring changes:
  - .specify/templates/tasks-template.md (task categorization remains valid; logging tasks may be added per-feature when relevant)
- Follow-up TODOs: none
-->

# FitHub Project Constitution

**Version:** 1.1.0  
**Ratification Date:** 2026-05-05  
**Last Amended:** 2026-05-06

## Overview

This constitution establishes the governance principles and practices for the FitHub project. FitHub is a cross-platform fitness data synchronization system that enables users to seamlessly sync their fitness data across multiple platforms (Strava, Suunto, Apple Health, Garmin Connect) without manual data entry or duplication issues.

This constitution serves as the reference for all specification, planning, and implementation work carried out under the FitHub project.

---

## Core Principles

### 1. Data Privacy & Security

**Core Rule:** All handling of user fitness and health data MUST comply with GDPR, CCPA, and relevant data protection regulations. Encryption at rest and in transit is non-negotiable.

**Specifics:**
- All user data (workout records, health metrics, personal information) must be encrypted with industry-standard algorithms (AES-256 at minimum).
- Data transmission between FitHub services and external fitness platforms MUST use TLS 1.3 or higher.
- User consent for data syncing MUST be explicit, granular, and revocable at any time.
- Third-party integrations (e.g., Strava, Garmin) MUST be vetted for security compliance before integration.
- Security audits SHOULD be conducted at least annually or when integrating new platforms.

**Rationale:** FitHub handles sensitive health data. Users must trust that their data is protected and their privacy respected. Regulatory compliance is non-negotiable.

---

### 2. Cross-Platform Integration

**Core Rule:** FitHub MUST reliably integrate with at least 5 major fitness platforms (long-term aspiration). Data sync operations MUST handle platform-specific API variations, rate limits, and data format differences transparently.

> **P2 Launch Deviation (documented):** v1 launches with Strava only (1 platform). Zwift was scoped out in `feat-007` because no public OAuth API exists. Garmin, Suunto, Apple Health, and others are future roadmap items. Any new removal or addition of a platform integration MUST document its deviation from this principle in the corresponding feature spec's Constitution Alignment Checklist.

**Specifics:**
- Each platform integration MUST have a documented adapter that normalizes platform-specific data into FitHub's canonical format.
- API integration MUST respect rate limits and retry logic with exponential backoff.
- Conflict detection (e.g., duplicate workouts from overlapping syncs) MUST be automated and surfaced to users with resolution options.
- Integration status monitoring SHOULD provide real-time feedback on sync health per platform.

**Rationale:** The core value proposition of FitHub is seamless cross-platform sync. This principle ensures that integrations are robust, maintainable, and user-transparent.

---

### 3. User Experience & Simplicity

**Core Rule:** FitHub interfaces (UI/UX) MUST prioritize simplicity and minimal friction. Users SHOULD be able to initiate and manage syncs with fewer than 3 taps/clicks.

**Specifics:**
- Onboarding flow MUST be completable in under 5 minutes without requiring manual API key entry (OAuth preferred).
- Sync status MUST be visible at a glance; users should not need to dig into settings to understand sync health.
- Error messages MUST be clear, actionable, and suggest remedies (not technical jargon).
- Advanced options SHOULD be hidden by default but available for power users.

**Rationale:** FitHub targets fitness enthusiasts, not technical users. Simplicity drives adoption and positive engagement.

---

### 4. Reliability & Uptime

**Core Rule:** FitHub sync operations MUST maintain 99.5% uptime (target SLA). When offline, the system MUST queue syncs and execute them reliably once connectivity is restored.

**Specifics:**
- Sync queue persistence MUST survive app restarts and device reboots.
- Failed sync attempts MUST retry with exponential backoff for up to 24 hours before alerting the user. After the retry window is exhausted, the connection MUST be flagged for user re-authentication and the user notified.
- Monitoring and alerting MUST detect degradation in sync reliability within 5 minutes.
- Post-incident reviews MUST document root causes and preventive actions.

**Rationale:** Users rely on FitHub to keep their fitness data in sync. Unreliability undermines trust and adoption. Offline-first queueing is essential for mobile users.

---

### 5. Performance & Real-Time Sync

**Core Rule:** Synced data MUST appear in target platforms within 5 minutes (P95 latency). Real-time sync is preferred where platform APIs support it.

**Specifics:**
- Sync latency MUST be monitored per platform and optimized regularly.
- Batching of sync operations SHOULD occur to minimize API calls without compromising latency.
- Caching strategies MUST be employed to reduce redundant API requests while respecting data freshness requirements.
- Performance regression tests MUST be part of the CI/CD pipeline.

**Rationale:** Timely data sync is a key success criterion. Users should feel confident that their workouts are reflected across platforms promptly.

---

### 6. Code Quality & Testing

**Core Rule:** All production code MUST be covered by automated tests. No feature is considered complete until tests are written, pass, and are integrated into CI/CD.

**Specifics:**
- Unit test coverage MUST be ≥80% for new code; incremental improvements on legacy code are expected.
- Integration tests MUST cover at least the happy path for each platform adapter.
- End-to-end (E2E) tests MUST validate full sync workflows on staging before production deployment.
- Code reviews MUST be conducted before merge; reviewers MUST verify test coverage and quality.
- Static analysis (linting, type checking) MUST pass in CI before code can be merged.
- Deprecated dependencies SHOULD be updated within 30 days of awareness; security patches MUST be applied within 7 days.

**Rationale:** High code quality reduces bugs, improves maintainability, and supports long-term project health. Automated testing catches regressions early.

---

### 7. Transparency & Communication

**Core Rule:** Project decisions, data handling practices, and sync status MUST be transparent to users and stakeholders. Users MUST be able to understand what data is being synced and why.

**Specifics:**
- Privacy policy MUST clearly explain data collection, retention, and third-party sharing.
- In-app or web dashboard MUST allow users to view sync history, data usage, and platform authorizations.
- Known issues or platform-specific limitations MUST be documented and communicated proactively.
- Release notes MUST document feature changes, fixes, and security updates.
- Technical status page MUST be maintained to show platform availability and sync health.

**Rationale:** Trust is foundational for a data-handling product. Transparent communication reduces user anxiety and builds long-term loyalty.

---

### 8. Functional & Structured Logging

**Core Rule:** All services MUST emit logs as structured, machine-parseable records (JSON or equivalent) describing functional events — what happened, for whom, and why — rather than ad-hoc free-text strings. Logs are a first-class observability product, not a debugging afterthought.

**Specifics:**
- Every log entry MUST include: ISO-8601 timestamp, severity level (`debug` | `info` | `warn` | `error`), service/module name, environment/stage, and a correlation/request ID where one exists.
- Logs MUST be **functional**: describe the business or domain event (e.g., `activity.synced`, `connection.refresh.failed`), not implementation noise (`"about to call function X"`).
- Logs MUST be **structured**: emit key/value fields rather than concatenating values into messages. Downstream tooling MUST be able to filter and aggregate without regex on free text.
- Sensitive data MUST NEVER be logged: no access/refresh tokens, no full OAuth payloads, no raw activity files, no PII beyond a stable internal `userId`. Token vault inputs and outputs are explicitly forbidden.
- `error` level logs MUST include an error code or typed identifier so they can be aggregated and alerted on; stack traces SHOULD be attached when available.
- Cross-service flows (sync, webhook handling, queue consumers) MUST propagate a correlation ID so a single user-visible operation can be traced end-to-end.
- Audit-relevant events (consent changes, token rotations, connection lifecycle, data exports/deletes) MUST also be persisted via the audit log module, in addition to operational logging.

**Rationale:** A fitness sync platform spans many asynchronous hops (API → queue → worker → external platform → webhook). Free-text logs make incidents undebuggable; structured functional logs make support, alerting, and compliance review tractable, and reduce the temptation to leak sensitive data into a string interpolation.

---

## Governance

### Amendment Process

1. **Proposal:** Any contributor MAY propose an amendment to this constitution by opening an issue or pull request.
2. **Discussion:** The amendment MUST be discussed with the core team and relevant stakeholders for at least 7 days.
3. **Ratification:** Amendments require consensus (or majority vote if needed). Ratified amendments MUST be documented with a new version.
4. **Implementation:** All dependent templates (spec, plan, task definitions) MUST be updated to reflect the amendment.

### Versioning

Constitution versions follow semantic versioning:
- **MAJOR:** Backward-incompatible governance changes (e.g., removal or redefinition of a principle).
- **MINOR:** New principle or significant expansion of existing principle guidance.
- **PATCH:** Clarifications, wording refinements, or non-semantic corrections.

### Compliance & Review

- This constitution MUST be reviewed at least annually.
- Any new feature or integration MUST be assessed for alignment with these principles before approval.
- Deviations from principles MUST be explicitly documented and approved by the core team.

---

## Related Documents

- **Project Intent:** `docs/project-intent.md` — Vision, problem statement, and success criteria for FitHub.
- **Specification Template:** `.specify/templates/spec-template.md` (to be created)
- **Plan Template:** `.specify/templates/plan-template.md` (to be created)
- **Task Template:** `.specify/templates/tasks-template.md` (to be created)
- **Privacy Policy:** (to be created)
- **Technical Status Page:** (to be created)

---

## Next Steps

1. Create dependent speckit templates (spec, plan, tasks) aligned with these principles.
2. Document initial integrations (Strava, Suunto, Apple Health, Garmin) against Data Privacy & Security and Cross-Platform Integration principles. Zwift removed in feat-007; deviation documented in P2.
3. Establish monitoring and alerting for Reliability & Performance principles.
4. Create user-facing documentation (privacy policy, in-app help, technical status page).
5. Set up code quality CI/CD checks aligned with Code Quality & Testing principle.
