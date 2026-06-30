#!/usr/bin/env bash
# =============================================================================
# Seed the public-demo admin account into a CLOUD Supabase project.
#   1. create the auth user admin@hermes.local via the GoTrue admin API
#   2. promote it to an admin profile (runs supabase/seed-admin.sql)
# Idempotent. Run AFTER `supabase db push` has applied the migrations.
#
# Required env:
#   SUPABASE_URL               https://<project-ref>.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY  service_role key  (Project Settings → API)
#   DEMO_ADMIN_PASSWORD        the REAL password for admin@hermes.local (strong!)
#   SUPABASE_DB_URL            Postgres URI      (Project Settings → Database →
#                              Connection string → URI; requires local `psql`)
#
# Usage:
#   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DEMO_ADMIN_PASSWORD=... \
#   SUPABASE_DB_URL=... ./scripts/seed-cloud-admin.sh
#
# No local psql? Skip SUPABASE_DB_URL and instead paste supabase/seed-admin.sql
# into the Supabase SQL Editor after this script creates the user.
# =============================================================================
set -euo pipefail

: "${SUPABASE_URL:?set SUPABASE_URL}"
: "${SUPABASE_SERVICE_ROLE_KEY:?set SUPABASE_SERVICE_ROLE_KEY}"
: "${DEMO_ADMIN_PASSWORD:?set DEMO_ADMIN_PASSWORD}"

ADMIN_EMAIL="admin@hermes.local"
SEED_SQL="$(cd "$(dirname "$0")/.." && pwd)/supabase/seed-admin.sql"

echo "[seed] creating ${ADMIN_EMAIL} via GoTrue admin API..."
code=$(curl -s -o /tmp/seed-cloud.json -w "%{http_code}" -X POST \
  "${SUPABASE_URL%/}/auth/v1/admin/users" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${DEMO_ADMIN_PASSWORD}\",\"email_confirm\":true}")
case "$code" in
  200|201) echo "[seed]   user created." ;;
  422)     echo "[seed]   user already exists (ok). If you changed DEMO_ADMIN_PASSWORD,"
           echo "[seed]   reset it in Authentication → Users → admin@hermes.local." ;;
  *)       echo "[seed]   ERROR (HTTP ${code}):"; cat /tmp/seed-cloud.json 2>/dev/null; echo; exit 1 ;;
esac

if [ -n "${SUPABASE_DB_URL:-}" ]; then
  echo "[seed] promoting ${ADMIN_EMAIL} to admin profile (psql)..."
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -f "$SEED_SQL"
  echo "[seed] done."
else
  echo "[seed] SUPABASE_DB_URL not set — now paste supabase/seed-admin.sql into the"
  echo "[seed] Supabase SQL Editor and run it to finish promoting the admin profile."
fi
