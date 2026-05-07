# Quickstart: feat-008 Auth Worker

## Prerequisites

- Node.js 20+, pnpm
- SST v3 with Cloudflare home configured
- Cloudflare account + Wrangler authenticated
- `AuthKv` and `FithubDb` already provisioned (from prior features)

## Local Development

The auth worker runs on Cloudflare Workers via SST — there is no local server simulation. Use `sst dev` which proxies to real Cloudflare Workers via live bindings.

```bash
# Install dependencies (from repo root)
pnpm install

# If adding @openauthjs/openauth to web package:
cd web && pnpm add @openauthjs/openauth && cd ..

# Start local dev (spins up real Cloudflare Workers via SST live)
pnpm sst dev
```

During development, the `sendCode` callback falls back to `console.log` when `App.stage !== "production"`. The OTP code will appear in the SST dev console output — no email account needed.

## Required Secrets

Add these secrets before first deploy:

```bash
pnpm sst secret set EMAIL_PROVIDER_KEY <resend-api-key>

# Remove the old signing key (no longer needed):
# pnpm sst secret remove OPENAUTH_SIGNING_KEY
```

## Testing the Sign-in Flow (dev)

1. Open `http://localhost:4321` (or the SST dev URL)
2. Click "Sign in to FitHub"
3. Enter any email address
4. Watch the SST dev console for the OTP code: `[DEV] Magic link code for user@example.com: 123456`
5. Enter the code in the browser (or click the console-logged link)
6. You should be redirected to `/dashboard`

## File Locations

| Component | Path |
|-----------|------|
| Auth worker | `packages/functions/src/auth/index.ts` |
| Shared subjects | `packages/functions/src/shared/subjects.ts` |
| API middleware | `packages/functions/src/api/middleware/auth.ts` |
| Web callback page | `web/src/pages/auth/callback.astro` |
| Web logout page | `web/src/pages/auth/logout.astro` |
| Web session lib | `web/src/lib/session.ts` |

## Deploying

```bash
# Deploy to staging
pnpm sst deploy --stage staging

# Deploy to production
pnpm sst deploy --stage production
```

The auth worker URL is automatically wired to the web frontend via SST resource linking — no manual `AUTH_WORKER_URL` update required.
