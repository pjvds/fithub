# Quickstart: BetterStack Observability

**Feature:** feat-007-betterstack-observability

---

## How it works

FitHub uses **Cloudflare Logpush** to stream Worker invocation traces directly to BetterStack — no custom code, no Tail Worker. Each of the 5 Workers has `logpush: true` in its script metadata; Cloudflare delivers structured `workers_trace_events` to BetterStack's HTTPS ingest endpoint automatically after each Worker invocation.

---

## Prerequisites

- BetterStack account created (confirmed)
- FitHub deployed to at least the `dev` stage (`sst deploy`)
- `GET /api/status` endpoint live
- Cloudflare Workers **Paid plan** (required for Logpush)

---

## Step 1: Create BetterStack Log Source

In the BetterStack dashboard:

1. Go to **Logs → Sources → Connect source**
2. Choose **HTTP source** (or search for "Cloudflare")
3. Name it `fithub-dev` (create a second `fithub-prod` for production)
4. Copy the **source token** — you'll need it in Step 2

---

## Step 2: Run Setup Script

The `scripts/setup-betterstack.ts` script creates the Cloudflare Logpush job pointing at BetterStack. Run it once per environment:

```bash
# Dry run first to preview
CLOUDFLARE_API_TOKEN=<cf-token> \
CLOUDFLARE_ACCOUNT_ID=<account-id> \
BETTER_STACK_TOKEN=<source-token> \
npx tsx scripts/setup-betterstack.ts --dry-run

# If output looks correct, run for real
CLOUDFLARE_API_TOKEN=<cf-token> \
CLOUDFLARE_ACCOUNT_ID=<account-id> \
BETTER_STACK_TOKEN=<source-token> \
npx tsx scripts/setup-betterstack.ts
```

This creates a Cloudflare Logpush job for `workers_trace_events` → BetterStack HTTPS endpoint.

---

## Step 3: Deploy

```bash
sst deploy
```

All 5 Workers already have `logpush: true` in `sst.config.ts`. Once deployed, Worker logs will flow through Cloudflare Logpush to BetterStack automatically.

**Verify:** Trigger `GET /api/status` and check BetterStack Logs for entries within 60 seconds.

---

## Step 4: Create Uptime Monitors (optional)

Get your BetterStack **API key** from the BetterStack dashboard (Settings → API).

```bash
CLOUDFLARE_API_TOKEN=<cf-token> \
CLOUDFLARE_ACCOUNT_ID=<account-id> \
BETTER_STACK_TOKEN=<source-token> \
BETTERSTACK_API_KEY=<api-key> \
API_URL=https://api.fithub.space \
AUTH_URL=https://auth.fithub.space \
npx tsx scripts/setup-betterstack.ts
```

This creates uptime monitors for both endpoints. Pass only `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`/`BETTER_STACK_TOKEN` to skip monitor creation.

---

## Step 5: Configure Error-Rate Alert (manual)

In BetterStack Logs dashboard:

1. Go to your `fithub-prod` source → **Alerts → New alert**
2. Query: `level = "error"`
3. Threshold: **> 10 occurrences in 1 minute**
4. Notification: your preferred channel (email, Slack, PagerDuty)

---

## Searching Logs

| Goal | BetterStack query |
|------|-------------------|
| All errors | `level:error` |
| Trace a request | `correlationId:"<id>"` |
| User's activity | `userId:"<uuid>"` |
| Sync job failures | `event:sync.job.failed` |
| Specific Worker | `service:"sync-worker"` |

---

## Runbook

See `docs/runbook.md` for incident response procedures.
