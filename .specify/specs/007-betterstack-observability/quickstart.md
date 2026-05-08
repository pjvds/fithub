# Quickstart: BetterStack Observability

**Feature:** feat-007-betterstack-observability

---

## Prerequisites

- BetterStack account created (confirmed)
- FitHub deployed to at least the `dev` stage (`sst deploy`)
- `GET /api/status` endpoint live (T064 — already shipped)
- `BETTER_STACK_TOKEN` added as a GitHub Environment secret under **Settings → Environments → dev → Environment secrets**

---

## Step 1: Create BetterStack Log Sources

In the BetterStack dashboard:

1. Go to **Logs → Sources → Connect source**
2. Choose **HTTP source**
3. Name it `fithub-dev` (create a second one `fithub-prod` for production)
4. Copy the **source token** — you'll need this in Step 2

---

## Step 2: Set the Secret in GitHub

Add the source token as a GitHub Environment secret:

1. Go to your repo → **Settings → Environments → dev → Environment secrets**
2. Add secret: `BETTER_STACK_TOKEN` = `<your-dev-source-token>`
3. Repeat for the `production` environment with the prod source token

The CI/CD pipeline (`ci.yml`) will call `sst secret set BetterStackToken` automatically on the next deploy.

---

## Step 3: Deploy

```bash
sst deploy
```

This deploys the Tail Worker and binds it to all 5 producing Workers. Logs will start appearing in BetterStack immediately.

**Verify:** Trigger a request to `GET /api/status` and check BetterStack Logs for an entry with `event: "status.queried"` (or any log from the API Worker) within 60 seconds.

---

## Step 4: Create Uptime Monitors

Get your BetterStack **Uptime API token** from the BetterStack dashboard (Settings → API).

```bash
# Install dependencies (tsx for running TypeScript scripts)
npm install -g tsx

# Run the setup script (dry-run first)
BETTER_STACK_UPTIME_TOKEN=<your-uptime-api-token> npx tsx scripts/setup-betterstack.ts --dry-run

# If output looks correct, run for real
BETTER_STACK_UPTIME_TOKEN=<your-uptime-api-token> npx tsx scripts/setup-betterstack.ts
```

This creates:
- `FitHub API` monitor → `https://api.fithub.space/api/status` (every 1 min)
- `FitHub Auth` monitor → `https://auth.fithub.space` (every 1 min)

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
