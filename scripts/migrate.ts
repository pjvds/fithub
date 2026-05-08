/**
 * D1 migration runner — executed via `sst shell --stage <stage> -- npx tsx scripts/migrate.ts`
 *
 * SST injects SST_RESOURCE_FithubDb (and other resource env vars) so that
 * `Resource.FithubDb` is available in Node.js. The D1 resource contains the
 * database ID which we use with the Cloudflare REST API to execute SQL.
 *
 * Migrations are tracked in a `__migrations` table so each file runs exactly once.
 */

import { Resource } from "sst";
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const db = Resource.FithubDb as unknown as { id: string };
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;

if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is not set");
if (!apiToken) throw new Error("CLOUDFLARE_API_TOKEN is not set");
if (!db?.id) throw new Error("Resource.FithubDb.id is not available");

const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${db.id}`;

async function d1Query<T = Record<string, unknown>>(
  sql: string,
  params: (string | number | null)[] = [],
): Promise<T[]> {
  const res = await fetch(`${baseUrl}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });

  const json = (await res.json()) as {
    success: boolean;
    errors: { message: string }[];
    result: { results: T[] }[];
  };

  if (!json.success) {
    throw new Error(`D1 query failed: ${json.errors.map((e) => e.message).join(", ")}`);
  }

  return json.result[0]?.results ?? [];
}

async function run() {
  // Bootstrap migration tracking table
  await d1Query(
    `CREATE TABLE IF NOT EXISTS __migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  );

  const migrationsDir = join(__dirname, "../drizzle/migrations");
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const applied = await d1Query<{ c: number }>(
      "SELECT COUNT(*) AS c FROM __migrations WHERE name = ?",
      [file],
    );

    if (applied[0]?.c > 0) {
      console.log(`⏭  Already applied: ${file}`);
      continue;
    }

    console.log(`▶  Applying: ${file}`);
    const sql = await readFile(join(migrationsDir, file), "utf8");

    // Split on statement-breakpoint comments and run each statement
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await d1Query(statement);
    }

    await d1Query("INSERT INTO __migrations (name) VALUES (?)", [file]);
    console.log(`✅ Applied: ${file}`);
  }

  console.log("🎉 All migrations applied.");
}

run().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
