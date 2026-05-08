#!/usr/bin/env bash
# Apply pending D1 migrations for a given SST stage.
# Usage: ./scripts/migrate-d1.sh <stage>
# Requires: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID env vars.
set -euo pipefail

STAGE="${1:-dev}"
MIGRATIONS_DIR="drizzle/migrations"

echo "🔍 Looking up D1 database for stage: $STAGE"

DB_NAME=$(npx wrangler d1 list --json 2>/dev/null \
  | python3 -c "
import sys, json
dbs = json.load(sys.stdin)
db = next((d for d in dbs if 'fithub-$STAGE' in d['name'] and 'fithubdb' in d['name'].lower()), None)
if not db:
    raise SystemExit('ERROR: D1 database not found for stage $STAGE')
print(db['name'])
")

echo "📦 Database: $DB_NAME"

# Bootstrap migration tracking table (idempotent)
printf 'Y\n' | npx wrangler d1 execute "$DB_NAME" --remote \
  --command "CREATE TABLE IF NOT EXISTS __migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))" \
  > /dev/null

# Apply each migration file in order, skip already-applied ones
for f in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
  name=$(basename "$f")

  count=$(printf 'Y\n' | npx wrangler d1 execute "$DB_NAME" --remote \
    --command "SELECT COUNT(*) AS c FROM __migrations WHERE name='$name'" \
    --json 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['results'][0]['c'])" \
    2>/dev/null || echo 0)

  if [ "$count" = "0" ]; then
    echo "▶  Applying: $name"
    printf 'Y\n' | npx wrangler d1 execute "$DB_NAME" --remote --file="$f" > /dev/null
    printf 'Y\n' | npx wrangler d1 execute "$DB_NAME" --remote \
      --command "INSERT INTO __migrations (name) VALUES ('$name')" > /dev/null
    echo "✅ Applied: $name"
  else
    echo "⏭  Already applied: $name"
  fi
done

echo "🎉 Migrations complete."
