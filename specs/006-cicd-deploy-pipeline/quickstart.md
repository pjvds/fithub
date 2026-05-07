# Quickstart: CI/CD Pipeline Setup

This guide documents the one-time setup steps required before the CI/CD pipeline can deploy successfully.

---

## Prerequisites

- Access to the GitHub repository with admin permissions (to configure Secrets and Environments)
- Access to the Cloudflare account where FitHub is deployed
- `sst` CLI installed locally (`npm install -g sst` or available via `npx`)
- All SST/Cloudflare resources already created (or will be created on first deploy)

---

## Step 1: Create a Cloudflare API Token

1. Go to [Cloudflare Dashboard → My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Click **Create Token** → **Create Custom Token**
3. Name: `fithub-github-actions-dev`
4. Set the following permissions:

   | Permission | Access |
   |---|---|
   | Workers Scripts | Edit |
   | Workers KV Storage | Edit |
   | Workers R2 Storage | Edit |
   | Workers D1 | Edit |
   | Cloudflare Pages | Edit |
   | Account Settings | Read |

5. Set **Account Resources**: Include → your FitHub account
6. Click **Continue to Summary** → **Create Token**
7. **Copy the token value** — you will not see it again

---

## Step 2: Create the GitHub Environment & Secrets

1. Go to your GitHub repository → **Settings** → **Environments**
2. Click **New environment**, name it: `dev`
3. Open the `dev` environment → **Add secret** for each of the following:

| Secret Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | API token from Step 1 |
| `TOKEN_MASTER_KEY` | 32-byte random hex string (e.g. `openssl rand -hex 32`) |
| `STRAVA_CLIENT_SECRET` | From [Strava API settings](https://www.strava.com/settings/api) |
| `STRAVA_CLIENT_ID` | From Strava API settings |
| `REDIRECT_BASE_URL` | `https://app.fithub.space` (or your custom domain) |
| `OPENAUTH_SIGNING_KEY` | 32-byte random hex string |

> **Deferred:** `APPLE_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET`, and `EMAIL_PROVIDER_KEY` are not required until the auth worker is implemented. They will be added back when that feature is built.

4. (Optional) Add environment protection rules if desired

---

## Step 3: SST App Secrets — Automated by CI

SST app secrets are automatically seeded by the pipeline on every deploy.
The `deploy-dev` job reads each secret from the GitHub Environment and runs
`sst secret set` before deploying — no manual local commands required.

> **Manual verification (optional):** After a successful deploy, run
> `npx sst secret list --stage dev` locally to confirm all secrets are present.

---

## Step 4: Trigger the Pipeline

Push any commit to `master`:

```bash
git push origin master
```

The pipeline will:
1. Run the `quality` job (lint, type check, tests, build)
2. If quality passes, run the `deploy-dev` job
3. SST deploys all Cloudflare resources for the `dev` stage

---

## Verifying the Deployment

After the pipeline completes:

- Check GitHub Actions → the `deploy-dev` job should show green
- Check the GitHub Environments panel → `dev` should show the latest deployment
- Visit the deployed URL (output by SST at the end of the deploy step)
- Run `npx sst console --stage dev` to inspect the deployed resources

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Deploy fails: "Authentication error" | `CLOUDFLARE_API_TOKEN` missing or wrong | Re-check Step 2; verify token permissions |
| App starts but crashes at runtime | SST app secrets not seeded | Run `sst secret set` for all missing secrets (Step 3) |
| Quality job fails: lint/typecheck | Code quality issues | Fix the reported errors locally and push again |
| `sst deploy` fails: "resource not found" | First deploy — resources don't exist yet | This is normal; SST will create them |
