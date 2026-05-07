# FitHub

> Cross-platform fitness data synchronization — backend + web (v1). Native mobile clients postponed.

FitHub consolidates activity data from cloud fitness platforms (Strava, …) behind a single API and surface, eliminating manual data entry and duplicate-activity confusion. v1 ships the backend plus a web frontend; native mobile (and Apple Health) is postponed until a later milestone.

## Repository Layout

```
fithub/
├── .specify/                # speckit (constitution, specs, plans, tasks, memory)
│   ├── memory/
│   │   ├── constitution.md
│   │   ├── architecture-overview.md
│   │   └── tech-stack.md
│   ├── specs/
│   │   ├── 000-backend-foundation/      # active
│   │   ├── 002-zwift-oauth/             # SUPERSEDED (Zwift removed)
│   │   ├── 003-strava-oauth/            # SUPERSEDED
│   │   ├── 004-apple-health-integration/# POSTPONED with mobile
│   │   └── 005-web-frontend/            # active
│   └── templates/
├── packages/
│   ├── core/                # shared types, Drizzle schema, Zod
│   └── functions/           # Cloudflare Workers (api, auth, sync, queues)
├── web/                     # Astro app (v1 user-facing client)
├── drizzle/                 # database migrations
├── mobile/                  # placeholder — see mobile/README.md
├── sst.config.ts            # SST app definition
├── package.json             # npm workspaces root
├── tsconfig.base.json
├── tsconfig.json
├── eslint.config.js
└── .env.example
```

The repository is an **SST monorepo** (npm workspaces). Backend Workers and the Astro web frontend share types from `@fithub/core` and ship through a single SST deploy.

## Spec Status (high level)

| Spec | Status | Notes |
|---|---|---|
| `000-backend-foundation` | Active | TypeScript + SST + Cloudflare backbone |
| `002-zwift-oauth` | **Superseded** | Mobile-flow Zwift OAuth; Zwift support removed in feat-007 |
| `003-strava-oauth` | **Superseded** | Mobile-flow OAuth; replaced by future `007-strava-oauth-web` |
| `004-apple-health-integration` | **Postponed** | Requires native iOS — revisit with mobile |
| `005-web-frontend` | Active | Astro web app — v1 user-facing client |

Authoritative architectural decisions live in `.specify/memory/architecture-overview.md`.

## Getting Started

> Phase 1 implementation of `000-backend-foundation` is in progress. Setup commands will be filled in here as the Phase 1 tasks land (SST init, schema migration, deploy preview, etc.). For now see `.specify/specs/000-backend-foundation/quickstart.md`.

## License

TBD.
