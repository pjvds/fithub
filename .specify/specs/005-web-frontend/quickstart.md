# Quickstart: 005-web-frontend

> Developer onboarding guide for the FitHub web application (Astro on Cloudflare Pages).

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | ≥20 LTS | Runtime for SST + Astro |
| pnpm | Latest | Package manager (npm workspaces) |
| SST CLI | v4 (Ion) | Infrastructure-as-code; `sst dev` runs all services locally |
| Cloudflare account | Workers Paid plan | Cloudflare Pages, D1, Workers, KV, Queues, R2, Durable Objects |

> **Note:** Wrangler CLI is optional. SST wraps Wrangler for dev; you only need it directly for ad-hoc operations like `wrangler tail` (log streaming).

---

## 1. Clone & Install

```bash
git clone <repo-url> fithub
cd fithub
pnpm install
```

---

## 2. Configure Cloudflare

```bash
export CLOUDFLARE_API_TOKEN=<your-token>
export CLOUDFLARE_ACCOUNT_ID=<your-account-id>
```

Create your API token at https://dash.cloudflare.com/profile/api-tokens with permissions for Workers, Pages, D1, KV, Queues, R2, and Durable Objects.

---

## 3. Configure Secrets (Dev Stage)

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

Required secrets for local dev:

| Secret | Where to get it |
|---|---|
| `TOKEN_MASTER_KEY` | Generate: `openssl rand -hex 32` |
| `ZWIFT_CLIENT_SECRET` | Zwift developer portal |
| `STRAVA_CLIENT_SECRET` | Strava API settings page |
| `OPENAUTH_SIGNING_KEY` | Generate: `openssl rand -hex 32` |

The remaining secrets (`APPLE_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET`, `EMAIL_PROVIDER_KEY`) are optional for local Zwift/Strava testing.

---

## 4. Start the Dev Environment

```bash
npx sst dev
```

This command starts:
- The API Worker at `http://localhost:8787`
- The Auth Worker at `http://localhost:8788`
- The Astro dev server at `http://localhost:4321` (or the port shown in output)

Open `http://localhost:4321` in your browser. You will be redirected to the login page.

> **SST dev vs Astro standalone:** `sst dev` is the correct way to run the full stack. Running `pnpm astro dev` from `web/` alone will start the Astro server but the API and auth workers will not be available.

---

## 5. Run with Mocked API (MSW Mode)

When the backend workers are not needed (e.g., pure UI work), start Astro in mock mode:

```bash
cd web
pnpm dev:mock
```

This starts Astro with `VITE_MOCK_API=true`, which activates the MSW service worker. All API requests are intercepted and served from `web/src/mocks/handlers.ts`. No Cloudflare credentials required.

MSW handlers return typed mock data that matches the `@fithub/core` schemas. If a schema changes, TypeScript will warn you.

---

## 6. Run Tests

### Unit & Integration Tests (Vitest + MSW)

```bash
cd web
pnpm test
```

Runs Vitest with MSW handlers active. Tests in `web/src/**/*.test.ts`.

### E2E Tests (Playwright)

E2E tests run against the full stack and require `sst dev` to be running first:

```bash
# Terminal 1
npx sst dev

# Terminal 2
cd web
pnpm test:e2e
```

Or against a deployed preview URL:

```bash
PLAYWRIGHT_BASE_URL=https://<preview>.pages.dev pnpm test:e2e
```

---

## 7. Run Lighthouse CI Locally

```bash
cd web
pnpm build
pnpm lhci:local
```

This runs Lighthouse against a local `astro preview` server. Scores below 90 for Performance or Best Practices will print a warning. The same check runs automatically in CI against preview deployments.

---

## 8. Useful Commands

| Command | What it does |
|---|---|
| `npx sst dev` | Start full stack (API + Auth Workers + Astro) |
| `cd web && pnpm dev:mock` | Start Astro with MSW (no backend needed) |
| `cd web && pnpm test` | Run Vitest unit/integration tests |
| `cd web && pnpm test:e2e` | Run Playwright E2E tests |
| `cd web && pnpm build` | Build Astro for Cloudflare Pages |
| `cd web && pnpm lint` | Run ESLint |
| `cd web && pnpm typecheck` | Run `tsc --noEmit` |
| `npx sst deploy --stage prod` | Deploy to production (run manually) |

---

## 9. Project Layout

```
fithub/
├── packages/
│   ├── core/          # Shared types, Drizzle schema, Zod — import as @fithub/core
│   └── functions/     # Cloudflare Workers (api, auth, sync orchestrators)
├── web/               # Astro app (this feature's deliverable)
│   ├── src/
│   │   ├── layouts/   # BaseLayout, AuthLayout
│   │   ├── pages/     # File-based routing (index, dashboard, settings, etc.)
│   │   ├── components/# UI components (ConnectionCard, ActivityFeed, etc.)
│   │   ├── lib/       # api-client.ts, logger.ts, utils
│   │   └── mocks/     # MSW handlers + fixture data
│   └── astro.config.ts
├── drizzle/           # D1 migrations
└── sst.config.ts
```

---

## 10. Common Issues

**`sst dev` fails with "CLOUDFLARE_API_TOKEN not set"**
Export `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` before running.

**Login redirects loop / 401 on `/api/me`**
The Auth Worker at `auth.fithub.app` does not exist in local dev yet. Ensure `OPENAUTH_SIGNING_KEY` is set and the auth Worker is running. In MSW mode this is not required.

**Lighthouse score < 90 on first run**
Often caused by large images or unoptimised fonts in dev builds. Run `pnpm build && pnpm lhci:local` (production build) — dev builds deliberately skip some optimisations.

**TypeScript errors in `web/` referencing `@fithub/core`**
Run `pnpm install` from the repo root to ensure workspace symlinks are created. Then restart your editor's TypeScript server.
