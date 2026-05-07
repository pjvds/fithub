# FitHub Development Guidelines

Auto-generated from feature plans. Last updated: 2026-05-06

## Active Technologies

| Layer | Technology |
|---|---|
| Runtime / Deploy | SST v4 + Cloudflare (Workers, D1, KV, R2, Queues, Durable Objects) |
| Language | TypeScript (strict mode throughout) |
| Web Frontend | Astro (on Cloudflare Pages / Static Site via SST) |
| API | Hono on Cloudflare Workers |
| Auth | OpenAuth.js (SST Auth) — self-hosted on Cloudflare Workers |
| Database | Cloudflare D1 (SQLite at edge) + Drizzle ORM |
| Schema validation | Zod |
| Testing | Vitest + `@vitest/coverage-v8` |
| Linting | ESLint (flat config) |
| Type checking | TypeScript (`tsc --noEmit`) |
| CI/CD | GitHub Actions → `npx sst deploy --stage dev` on push to `master` |
| Dedup | Custom scorer in `packages/dedup/` (score 0–100, reason string) |

## Project Structure

```text
fithub/
├── .specify/                   # speckit memory, templates, scripts
├── .github/
│   ├── agents/
│   │   └── copilot-instructions.md
│   └── workflows/
│       └── ci.yml              # Quality gate + deploy-dev
├── sst.config.ts               # SST project root — all infra declared here
├── package.json                # npm workspaces: packages/*, web
├── tsconfig.base.json
├── packages/
│   ├── core/                   # Shared types, Zod schemas, canonical models
│   ├── functions/              # Cloudflare Workers (api, auth, scheduler, worker)
│   └── dedup/                  # Duplicate-detection engine + scorer
├── web/                        # Astro web app (workspace member)
├── drizzle/                    # D1 schema migrations
├── specs/                      # Feature specs (speckit)
└── mobile/                     # Placeholder — native mobile deferred
```

## Git Commits

- **Never** include a `Co-authored-by` trailer in commit messages.
- Commit messages must be **functional and descriptive** — a reader unfamiliar with internal feature names must understand what changed and why.
  - ❌ `fix(ci): commit feat-008 auth changes that were never staged`
  - ❌ `feat(008): add auth worker` ← internal tracking IDs mean nothing to readers
  - ✅ `fix(ci): add missing auth worker files and resend dependency`
  - ✅ `feat(auth): add OpenAuth.js issuer worker with magic-link email flow`
- Never reference internal spec/task IDs (feat-008, T017, etc.) in commit messages. Describe the actual change.

## Before Every Push — Simulate CI Locally

Run these in order. Fix any failures before pushing.

```bash
npm ci           # strict install — catches package.json / lock file drift
npm run lint
npm run typecheck
npm test
```

## Commands

```bash
# Install dependencies
npm install

# Start local dev (SST dev mode — all workers hot-reload)
npx sst dev

# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Type check all packages
npm run typecheck

# Lint everything
npm run lint

# Build web frontend
npm run build --workspace=web

# Deploy to dev stage (CI runs this — don't run locally unless intentional)
npx sst deploy --stage dev

# Set an SST app secret
npx sst secret set <SECRET_NAME> <value> --stage dev

# List all SST secrets for dev stage
npx sst secret list --stage dev
```

## Code Style

- **TypeScript strict mode** everywhere (`"strict": true`)
- Prefer `type` over `interface` for data shapes; `interface` only for extension points
- Zod schemas are the source of truth for runtime types; derive TS types with `z.infer<>`
- No `any` — use `unknown` + type guards if genuinely unknown
- Worker entry points export a default `{ fetch, scheduled, ... }` handler
- Shared code lives in `packages/core/` — Workers and web import from `@fithub/core`
- Dedup engine: every `DedupResult` must have `score` (0–100) and `reason` (human-readable string)

## Recent Changes

- **feat-006 (in progress):** CI/CD pipeline — GitHub Actions quality gate + auto-deploy to `dev` on push to `master`
- **feat-005 (complete):** Astro web frontend — full user-facing app scaffolded, deployed via SST StaticSite
- **feat-dedup (complete):** Deduplication engine with reasoning — scorer returns `{ score, isDuplicate, reason }` for transparent duplicate detection

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
