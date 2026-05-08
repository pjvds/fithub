#!/usr/bin/env npx tsx
/**
 * One-time setup: creates Cloudflare Logpush job + BetterStack Uptime monitors.
 * Idempotent — safe to run multiple times.
 *
 * Required env vars:
 *   CLOUDFLARE_API_TOKEN   - Cloudflare API token with Logs Edit permission
 *   CLOUDFLARE_ACCOUNT_ID  - Cloudflare account ID
 *   BETTER_STACK_TOKEN     - BetterStack source token (from Logs → Sources → Connect source)
 *
 * Optional:
 *   BETTERSTACK_API_KEY    - BetterStack API key (for creating Uptime monitors)
 *   API_URL                - Base URL of the API worker (for uptime monitoring)
 *   AUTH_URL               - Base URL of the Auth worker (for uptime monitoring)
 *
 * Usage:
 *   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... BETTER_STACK_TOKEN=... npx tsx scripts/setup-betterstack.ts
 *   Add --dry-run to preview without making API calls
 */

const DRY_RUN = process.argv.includes("--dry-run");

const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? "";
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const BETTER_STACK_TOKEN = process.env.BETTER_STACK_TOKEN ?? "";
const BETTERSTACK_API_KEY = process.env.BETTERSTACK_API_KEY ?? "";
const API_URL = process.env.API_URL ?? "";
const AUTH_URL = process.env.AUTH_URL ?? "";

const BETTERSTACK_INGEST_URL = `https://in.logs.betterstack.com?header_Authorization=Bearer%20${BETTER_STACK_TOKEN}`;
const CF_API = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}`;
const BETTERSTACK_API = "https://uptime.betterstack.com/api/v2";

// ─── Validation ──────────────────────────────────────────────────────────────

function validateEnv() {
  const required: [string, string][] = [
    ["CLOUDFLARE_API_TOKEN", CF_API_TOKEN],
    ["CLOUDFLARE_ACCOUNT_ID", CF_ACCOUNT_ID],
    ["BETTER_STACK_TOKEN", BETTER_STACK_TOKEN],
  ];
  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    console.error(`❌ Missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
  }
}

// ─── Cloudflare Logpush ───────────────────────────────────────────────────────

interface LogpushJob {
  id: number;
  name: string;
  dataset: string;
  destination_conf: string;
  enabled: boolean;
}

async function listLogpushJobs(): Promise<LogpushJob[]> {
  const res = await fetch(`${CF_API}/logpush/jobs`, {
    headers: { Authorization: `Bearer ${CF_API_TOKEN}` },
  });
  const json = (await res.json()) as { result: LogpushJob[]; success: boolean };
  if (!json.success) throw new Error(`Cloudflare API error: ${JSON.stringify(json)}`);
  return json.result ?? [];
}

async function createLogpushJob() {
  const jobs = await listLogpushJobs();
  const existing = jobs.find(
    (j) => j.dataset === "workers_trace_events" && j.destination_conf.includes("betterstack.com"),
  );

  if (existing) {
    console.log(`✅ Logpush job already exists (id=${existing.id}, enabled=${existing.enabled})`);
    if (!existing.enabled) {
      console.log("   ⚠️  Job is disabled — enable it in the Cloudflare dashboard or via API.");
    }
    return;
  }

  console.log("Creating Cloudflare Logpush job for workers_trace_events → BetterStack...");

  if (DRY_RUN) {
    console.log("   [dry-run] POST", `${CF_API}/logpush/jobs`);
    console.log("   payload:", {
      name: "fithub-workers-betterstack",
      dataset: "workers_trace_events",
      destination_conf: BETTERSTACK_INGEST_URL.replace(BETTER_STACK_TOKEN, "<TOKEN>"),
      enabled: true,
    });
    return;
  }

  const res = await fetch(`${CF_API}/logpush/jobs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "fithub-workers-betterstack",
      dataset: "workers_trace_events",
      destination_conf: BETTERSTACK_INGEST_URL,
      enabled: true,
    }),
  });

  const json = (await res.json()) as { result: LogpushJob; success: boolean; errors?: unknown[] };
  if (!json.success) throw new Error(`Failed to create Logpush job: ${JSON.stringify(json)}`);
  console.log(`✅ Logpush job created (id=${json.result.id})`);
}

// ─── BetterStack Uptime Monitors ─────────────────────────────────────────────

interface UptimeMonitor {
  id: string;
  attributes: { url: string; pronounceable_name: string };
}

async function listUptimeMonitors(): Promise<UptimeMonitor[]> {
  const res = await fetch(`${BETTERSTACK_API}/monitors`, {
    headers: { Authorization: `Bearer ${BETTERSTACK_API_KEY}` },
  });
  const json = (await res.json()) as { data: UptimeMonitor[] };
  return json.data ?? [];
}

async function ensureUptimeMonitor(name: string, url: string) {
  const monitors = await listUptimeMonitors();
  const existing = monitors.find((m) => m.attributes.url === url);

  if (existing) {
    console.log(`✅ Uptime monitor already exists: ${name} (${url})`);
    return;
  }

  console.log(`Creating uptime monitor: ${name} → ${url}`);

  if (DRY_RUN) {
    console.log("   [dry-run] POST", `${BETTERSTACK_API}/monitors`);
    console.log("   payload:", { pronounceable_name: name, url, check_frequency: 180 });
    return;
  }

  const res = await fetch(`${BETTERSTACK_API}/monitors`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${BETTERSTACK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pronounceable_name: name, url, check_frequency: 180 }),
  });

  if (!res.ok) throw new Error(`Failed to create monitor: ${res.status} ${await res.text()}`);
  console.log(`✅ Uptime monitor created: ${name}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (DRY_RUN) console.log("🔍 Dry run — no changes will be made\n");

  validateEnv();

  await createLogpushJob();

  if (BETTERSTACK_API_KEY && API_URL) {
    await ensureUptimeMonitor("FitHub API /health", `${API_URL}/health`);
  } else {
    console.log("⏭️  Skipping uptime monitors (BETTERSTACK_API_KEY or API_URL not set)");
  }

  if (BETTERSTACK_API_KEY && AUTH_URL) {
    await ensureUptimeMonitor("FitHub Auth /health", `${AUTH_URL}/health`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("❌", err);
  process.exit(1);
});
