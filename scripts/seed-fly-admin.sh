#!/usr/bin/env bash
# =============================================================================
# Seed admin@hermes.local on Fly deployment (aria-mantu-*.fly.dev)
# =============================================================================
# Creates the GoTrue user and Postgres profile+workspace for password login.
# Run from local machine with `fly` CLI authenticated to the Fly org.
#
# Required env:
#   DEMO_ADMIN_PASSWORD  Strong password for admin@hermes.local (will be the
#                        real login password, and optionally the demo-login
#                        backend secret if NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true)
#
# Usage:
#   DEMO_ADMIN_PASSWORD=<strong-password> ./scripts/seed-fly-admin.sh
#
# Idempotent: safe to re-run. If the user already exists (HTTP 422), the
# script continues to promote the profile (in case that step failed before).
# =============================================================================
set -euo pipefail

: "${DEMO_ADMIN_PASSWORD:?set DEMO_ADMIN_PASSWORD}"

ADMIN_EMAIL="admin@hermes.local"
SUPABASE_URL="https://aria-mantu-kong.fly.dev"

echo "[fly-seed] Reading SUPABASE_SERVICE_ROLE_KEY from aria-mantu-app secrets..."
SERVICE_ROLE_KEY=$(fly secrets list -a aria-mantu-app -j 2>/dev/null | jq -r '.[] | select(.Name=="SUPABASE_SERVICE_ROLE_KEY") | .Value' || echo "")

if [ -z "$SERVICE_ROLE_KEY" ]; then
  echo "[fly-seed] ERROR: Could not read SUPABASE_SERVICE_ROLE_KEY."
  echo "[fly-seed] Check: fly secrets list -a aria-mantu-app"
  echo "[fly-seed] The secret must exist before seeding."
  exit 1
fi

echo "[fly-seed] Creating ${ADMIN_EMAIL} in GoTrue (aria-mantu-auth)..."
code=$(curl -s -o /tmp/fly-seed-gotrue.json -w "%{http_code}" -X POST \
  "${SUPABASE_URL}/auth/v1/admin/users" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${DEMO_ADMIN_PASSWORD}\",\"email_confirm\":true}")

case "$code" in
  200|201) echo "[fly-seed]   User created (HTTP ${code})." ;;
  422)     echo "[fly-seed]   User already exists (HTTP 422, ok)."
           echo "[fly-seed]   If you changed DEMO_ADMIN_PASSWORD, the old password is still active."
           echo "[fly-seed]   To update it, use the GoTrue admin API or Supabase Dashboard." ;;
  *)       echo "[fly-seed]   ERROR (HTTP ${code}):"; cat /tmp/fly-seed-gotrue.json 2>/dev/null || echo "<no response>"; echo; exit 1 ;;
esac

echo "[fly-seed] Promoting ${ADMIN_EMAIL} to admin profile in Postgres (aria-mantu-db)..."
fly ssh console -a aria-mantu-db -C "psql -U postgres -d postgres" <<'SQL'
insert into public.workspaces (name, allowed_domain)
  values ('Hermes Workspace', 'hermes.local')
  on conflict (allowed_domain) do nothing;

insert into public.profiles (id, email, full_name, workspace_id, role)
  select u.id, u.email, 'Admin', w.id, 'admin'
  from auth.users u
  join public.workspaces w on w.allowed_domain = 'hermes.local'
  where u.email = 'admin@hermes.local'
  on conflict (id) do update
    set role = 'admin',
        workspace_id = excluded.workspace_id,
        email = excluded.email;

notify pgrst, 'reload schema';
SQL

echo ""
echo "[fly-seed] ==================================================================="
echo "[fly-seed] DONE. Login credentials for https://aria-mantu-app.fly.dev/"
echo "[fly-seed] ==================================================================="
echo "[fly-seed]   Email:    ${ADMIN_EMAIL}"
echo "[fly-seed]   Password: <DEMO_ADMIN_PASSWORD you set above>"
echo "[fly-seed] ==================================================================="
echo "[fly-seed] To enable one-click demo login (ENTER THE DEMO CONSOLE button):"
echo "[fly-seed]   1. fly secrets set DEMO_ADMIN_PASSWORD=<same password> -a aria-mantu-app"
echo "[fly-seed]   2. Set NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true in fly.app.toml line 20"
echo "[fly-seed]   3. Redeploy: fly deploy -c fly.app.toml -a aria-mantu-app"
echo "[fly-seed] ==================================================================="
