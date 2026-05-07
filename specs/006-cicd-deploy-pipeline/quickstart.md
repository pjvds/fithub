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

## Step 2: Create the GitHub Environment & Secret

1. Go to your GitHub repository → **Settings** → **Environments**
2. Click **New environment**, name it: `dev`
3. Open the `dev` environment → **Add secret**
4. Name: `CLOUDFLARE_API_TOKEN`, Value: paste the token from Step 1
5. (Optional) Add environment protection rules if desired

---

## Step 3: Seed SST App Secrets

SST app secrets are stored in Cloudflare's secret store — **not** in GitHub. Run these commands once from your local machine (from the repo root):

```bash
# Set each secret for the dev stage
npx sst secret set TOKEN_MASTER_KEY "<value>" --stage dev
npx sst secret set STRAVA_CLIENT_SECRET "<value>" --stage dev
npx sst secret set STRAVA_CLIENT_ID "<value>" --stage dev
npx sst secret set REDIRECT_BASE_URL "https://app.fithub.app" --stage dev
npx sst secret set OPENAUTH_SIGNING_KEY "<value>" --stage dev
npx sst secret set APPLE_CLIENT_SECRET "<value>" --stage dev
npx sst secret set GOOGLE_CLIENT_SECRET "<value>" --stage dev
npx sst secret set EMAIL_PROVIDER_KEY "<value>" --stage dev
```

> **Note:** Run `npx sst secret list --stage dev` to verify all secrets are set.

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
