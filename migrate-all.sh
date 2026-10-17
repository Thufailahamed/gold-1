#!/usr/bin/env bash
# One command: migrate EVERY database and deploy the backend.
#
#   ./migrate-all.sh
#
# Needs no passwords — only `wrangler login` (or CLOUDFLARE_API_TOKEN), which
# you already use to deploy. In order it:
#   1. bundles + typechecks the API
#   2. migrates the platform database
#   3. migrates the legacy main database (goldos)
#   4. sets the FLEET_MIGRATE_TOKEN worker secret (generated once, kept in the
#      git-ignored .migrate-token file)
#   5. deploys the backend worker
#   6. migrates EVERY shop database (old D1 shops and Durable-Object shops) by
#      calling the worker, repeating until no shop is deferred
# Safe to re-run: applied migrations are tracked per database, and each shop
# migrates atomically (a failing shop rolls back; the rest carry on).
#
# Options:  --status  only report which shops are behind
#           --no-deploy  --skip-main  --skip-fleet
# Env:      API_URL (default https://goldos-api.thufailahamed627.workers.dev)
set -euo pipefail
export PATH="$HOME/Library/pnpm/bin:/usr/local/bin:$PATH"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$ROOT/apps/api"
API_URL="${API_URL:-https://goldos-api.thufailahamed627.workers.dev}"
TOKEN_FILE="$ROOT/.migrate-token"
P="$API_URL/platform/v1"
DEPLOY=1; MAIN=1; FLEET=1; STATUS_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --no-deploy) DEPLOY=0 ;;
    --skip-main) MAIN=0 ;;
    --skip-fleet) FLEET=0 ;;
    --status) STATUS_ONLY=1 ;;
    -h|--help) sed -n '2,23p' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg (see --help)" >&2; exit 1 ;;
  esac
done
cd "$ROOT"

if [ ! -s "$TOKEN_FILE" ]; then
  umask 077; openssl rand -hex 32 > "$TOKEN_FILE"
  echo "==> Generated $TOKEN_FILE (git-ignored)"
fi
TOKEN="$(cat "$TOKEN_FILE")"

fleet_call() { curl -sS -m 900 -X POST -H "x-migrate-token: $TOKEN" "$P/migrate-fleet"; }
print_fleet() {
  python3 -c "
import sys,json
d=json.load(sys.stdin)
if not d.get('success'): print('    ERROR:', d.get('error')); sys.exit(2)
r=d['data']['result']; f=d['data']['fleet']
print('    shops=%s migrated=%s up-to-date=%s failed=%s unreachable=%s deferred=%s' % (r['shops'],r['migrated'],r['upToDate'],r['failed'],r['unreachable'],r['deferred']))
for x in r['results']:
    if x['status'] in ('failed','unreachable'): print('    !', x['slug'], x['status'], x.get('error',''))
print('    latest:', f['latest'], '| behind:', f['behind'], 'of', f['total'])
open('/tmp/.fleet_counts','w').write('%s %s' % (r['deferred'], r['failed']+r['unreachable']))
"
}

if [ "$STATUS_ONLY" -eq 1 ]; then
  echo "==> Fleet status (runs a no-op pass if everything is current)"
  fleet_call | print_fleet; exit 0
fi

echo "==> Bundling migrations + typechecking"
pnpm --filter goldos-api run bundle:migrations
pnpm --filter goldos-api exec tsc --noEmit

echo "==> Platform database"
(cd "$API_DIR" && pnpm exec wrangler d1 migrations apply PLATFORM_DB --remote)

if [ "$MAIN" -eq 1 ]; then
  echo "==> Main database (goldos)"
  wrun() { (cd "$API_DIR" && pnpm exec wrangler d1 execute goldos --remote -y "$@" --json 2>/dev/null); }
  query_one() { wrun --command "$1" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['results'][0]['$2'])"; }
  wrun --command "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);" > /dev/null
  APPLIED=0
  for f in "$API_DIR"/drizzle/*.sql; do
    v="$(basename "$f" | cut -d_ -f1)"
    [ "$(query_one "SELECT COUNT(*) AS c FROM schema_migrations WHERE version = '$v';" c)" = "1" ] && continue
    echo "    [$v] applying $(basename "$f")"
    (cd "$API_DIR" && pnpm exec wrangler d1 execute goldos --remote -y --file "$f")
    wrun --command "INSERT INTO schema_migrations (version, applied_at) VALUES ('$v', $(date +%s)000);" > /dev/null
    APPLIED=$((APPLIED + 1))
  done
  echo "    applied this run: $APPLIED"
fi

if [ "$DEPLOY" -eq 1 ]; then
  echo "==> Worker secret + deploy"
  (cd "$API_DIR" && printf '%s' "$TOKEN" | pnpm exec wrangler secret put FLEET_MIGRATE_TOKEN > /dev/null)
  (cd "$API_DIR" && pnpm exec wrangler deploy)
  echo "==> Health check"
  curl -sf -m 20 "$API_URL/api/v1/health" | grep -q '"ok":true' || { echo "    health check FAILED" >&2; exit 1; }
fi

FAILED=0
if [ "$FLEET" -eq 1 ]; then
  echo "==> Every shop database"
  for i in $(seq 1 40); do
    echo "  pass $i"
    fleet_call | print_fleet
    read -r DEFERRED FAILED < /tmp/.fleet_counts
    [ "$DEFERRED" -eq 0 ] && break
  done
fi

if [ "$FAILED" -gt 0 ]; then echo "==> $FAILED shop(s) failed or unreachable — fix and re-run" >&2; exit 1; fi
echo "==> Done"
