#!/bin/sh
# Real-tenant bootstrap: apply every numbered app migration in lexical order, then tell
# PostgREST to reload its schema cache. Idempotent — safe to re-run. Does NOT seed the demo
# admin (that is the compose-only run.sh); the real tenant's first admin is created by
# signing up (migration 0018 first-login grant), see runbook step 11.
set -eu

DB="${ADMIN_DB_URL:?ADMIN_DB_URL required}"

echo "[migrate] applying app migrations (/migrations/0*.sql in lexical order; 0016 intentionally absent)..."
for f in /migrations/0*.sql; do
  echo "[migrate]   -> $(basename "$f")"
  psql "$DB" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "[migrate] reloading the PostgREST schema cache..."
psql "$DB" -v ON_ERROR_STOP=1 -q -c "notify pgrst, 'reload schema';"

echo "[migrate] done."
