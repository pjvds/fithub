# Mobile (placeholder)

> **Status:** Postponed.
> **Last updated:** 2026-05-06

This directory is a placeholder for a future native mobile client.

## Why this exists but is empty

FitHub v1 ships **backend + web** (see `../.specify/specs/000-backend-foundation/` and `../.specify/specs/005-web-frontend/`). Native mobile was postponed during the 2026-05-06 pivot:

- Apple Health / HealthKit access requires a native client and has no web equivalent — this is the only feature the v1 web app cannot offer
- A web-first launch reduces scope and gets the deduplication / sync engine in front of users sooner
- The framework choice (Flutter, React Native, Capacitor, native SwiftUI/Kotlin, …) is **deferred** and will be made fresh in a future spec

## When it returns

Reviving mobile means:

1. Writing a new spec (e.g., `00X-mobile-client`) that re-evaluates framework options against constraints that exist *at that time*
2. Reviving `004-apple-health-integration` (currently POSTPONED) — its architecture (events, ingestion endpoint, dedup rules) is preserved in `.specify/memory/architecture-overview.md`
3. Building out the Push Notification Worker subscriber (the events are already emitted by the backend; only the consumer is deferred)
4. Evaluating what platform integrations make sense for mobile (Strava OAuth flows exist in `003-strava-oauth`; Zwift support was removed from the project)

## Related

- `.specify/memory/architecture-overview.md` — keeps the future mobile tier documented
- `.specify/specs/004-apple-health-integration/spec.md` — POSTPONED but retained
