#!/usr/bin/env bash
# Push ALL backend DB migrations to Cloudflare D1 (remote) and deploy the API worker.
#
# Usage:
#   ./scripts/cloudflare-sync.sh                # migrate DB + deploy backend
#   ./scripts/cloudflare-sync.sh --db-only       # migrate DB only
#   ./scripts/cloudflare-sync.sh --backend-only  # deploy backend only
#
# Requirements: `wrangler login` (or CLOUDFLARE_API_TOKEN), run from repo root.
# Migrations are tracked in the remote `schema_migrations` table, so re-runs
# only apply pending files from apps/api/drizzle/*.sql in sorted order.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT/apps/api"
DB_NAME="goldos"
DO_DB=1
DO_BACKEND=1

for arg in "$@"; do
  case "$arg" in
    --db-only) DO_BACKEND=0 ;;
    --backend-only) DO_DB=0 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg (see --help)" >&2; exit 1 ;;
  esac
done

cd "$ROOT"

wrun() { # $1 = SQL single statement or file flag pair
  pnpm --filter goldos-api exec wrangler d1 execute "$DB_NAME" --remote "$@" --json 2>/dev/null
}

query_one() { # $1 = SQL returning single row; $2 = column
  wrun --command "$1" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['results'][0]['$2'])"
}

if [ "$DO_DB" -eq 1 ]; then
  echo "==> Ensuring schema_migrations table"
  wrun --command "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);" > /dev/null

  # One-time baseline: DBs migrated manually before this script existed have
  # no tracking rows. Detect completed work via schema markers and record it.
  if [ "$(query_one "SELECT COUNT(*) AS c FROM schema_migrations;" c)" = "0" ]; then
    if [ "$(query_one "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='old_gold_items';" c)" = "1" ]; then
      echo "==> Baseline: detected migrations 0001-0011 already applied, recording"
      for v in 0001 0002 0003 0004 0005 0006 0007 0008 0009 0010 0011; do
        wrun --command "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES ('$v', $(date +%s)000);" > /dev/null
      done
    fi
    if [ "$(query_one "SELECT COUNT(*) AS c FROM pragma_table_info('gold_movements') WHERE name='old_gold_id';" c)" = "1" ]; then
      echo "==> Baseline: detected migration 0012 already applied, recording"
      wrun --command "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES ('0012', $(date +%s)000);" > /dev/null
    fi
  fi

  echo "==> Applying pending migrations"
  APPLIED=0
  for f in "$API_DIR"/drizzle/*.sql; do
    v="$(basename "$f" | cut -d_ -f1)"
    if [ "$(query_one "SELECT COUNT(*) AS c FROM schema_migrations WHERE version = '$v';" c)" = "1" ]; then
      echo "    [$v] already applied, skipping"
      continue
    fi
    echo "    [$v] applying $(basename "$f")..."
    pnpm --filter goldos-api exec wrangler d1 execute "$DB_NAME" --remote --file "$f"
    wrun --command "INSERT INTO schema_migrations (version, applied_at) VALUES ('$v', $(date +%s)000);" > /dev/null
    APPLIED=$((APPLIED + 1))
  done
  echo "==> Migrations applied this run: $APPLIED"

  echo "==> Remote DB state"
  echo "    permissions: $(query_one 'SELECT COUNT(*) AS c FROM permissions;' c)"
  echo "    tracked migrations: $(query_one 'SELECT COUNT(*) AS c FROM schema_migrations;' c)"
fi

if [ "$DO_BACKEND" -eq 1 ]; then
  echo "==> Typechecking API"
  pnpm --filter goldos-api exec tsc --noEmit
  echo "==> Deploying worker"
  DEPLOY_OUT="$(mktemp)"
  pnpm --filter goldos-api exec wrangler deploy 2>&1 | tee "$DEPLOY_OUT"
  URL="$(grep -oE 'https://[a-z0-9-]+\.[a-z0-9.-]+\.workers\.dev' "$DEPLOY_OUT" | head -1 || true)"
  rm -f "$DEPLOY_OUT"
  echo "==> Health check"
  CHECK_URLS="$URL
https://goldos-api.thufailahamed627.workers.dev"
  echo "$CHECK_URLS" | sort -u | while IFS= read -r target; do
    [ -n "$target" ] || continue
    if curl -sf -m 15 "$target/api/v1/health" | grep -q '"ok":true'; then
      echo "    OK: $target"
    else
      echo "    FAILED: $target" >&2
      exit 1
    fi
  done
fi

echo "==> Done"
