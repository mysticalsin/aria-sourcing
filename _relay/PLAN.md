# PLAN: Ship 2 - Working Login on Fly

**Basis:** fix/fly-auth-public-origin @ 7417cd0 (after ship 1)
**Written:** 2026-08-25
**Scope:** Document seed process and optionally enable demo login. No Fly deploy.

## Current State

Ship 1 (auth redirect fix) is committed. PR URL: https://github.com/mysticalsin/aria-sourcing/pull/new/fix/fly-auth-public-origin

After ship 1 deploys, redirects will work, but login still has no valid credentials on Fly.

## Problem

Fly has no user in GoTrue. Login page shows empty username/password fields with no way to proceed.

## Required Seeding Steps for Tony

**Step 1: Create admin@hermes.local in GoTrue**

```bash
# Set these first
SUPABASE_URL="https://aria-mantu-kong.fly.dev"
DEMO_ADMIN_PASSWORD="<strong-password-tony-picks>"

# Get service role key from Fly secrets
SERVICE_ROLE_KEY=$(fly secrets list -a aria-mantu-app | grep SUPABASE_SERVICE_ROLE_KEY | awk '{print $3}')

# Create user via GoTrue admin API
curl -X POST "${SUPABASE_URL}/auth/v1/admin/users" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@hermes.local","password":"'"${DEMO_ADMIN_PASSWORD}"'","email_confirm":true}'
```

Expected: HTTP 200 or 201 (success), or 422 if user already exists (ok).

**Step 2: Create profile and workspace in Postgres**

```bash
# Get DB password from Fly secrets
DB_PASSWORD=$(fly secrets list -a aria-mantu-db | grep POSTGRES_PASSWORD | awk '{print $3}')

# Connect via fly ssh console and run seed SQL
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
```

**Step 3A: Password Login (Current)**

After steps 1-2, password login works:
- Open https://aria-mantu-app.fly.dev/
- Enter: admin@hermes.local
- Password: <DEMO_ADMIN_PASSWORD from step 1>
- Should land on Command Center

**Step 3B: Demo Login (Optional)**

If Tony wants ENTER THE DEMO CONSOLE button like Vercel:

1. Set Fly secret:
```bash
fly secrets set DEMO_ADMIN_PASSWORD=<same password from step 1> -a aria-mantu-app
```

2. Update fly.app.toml line 20:
```toml
NEXT_PUBLIC_ENABLE_DEMO_LOGIN = "true"
```

3. Redeploy aria-mantu-app

Then one-click admin/admin works (resolves to admin@hermes.local with DEMO_ADMIN_PASSWORD).

## Decision: Keep Password Login for Now

Demo login is identical to Vercel's flag and proven safe (commit 58449e7 shows the change, was reverted in 5dec0e1). But Tony needs to seed the user FIRST before demo login works anyway.

Recommendation: Document password login steps above. Tony can enable demo login later if desired. It's one env var change, no code.

## In-Repo Change for Ship 2

Create scripts/seed-fly-admin.sh that documents the exact commands for Fly:

```bash
#!/usr/bin/env bash
# Seed admin@hermes.local on Fly deployment.
# Run from local machine with `fly` CLI authenticated to the Fly org.
#
# Required:
#   DEMO_ADMIN_PASSWORD environment variable
#
# Usage:
#   DEMO_ADMIN_PASSWORD=<strong-password> ./scripts/seed-fly-admin.sh

set -euo pipefail
: "${DEMO_ADMIN_PASSWORD:?set DEMO_ADMIN_PASSWORD}"

ADMIN_EMAIL="admin@hermes.local"
SUPABASE_URL="https://aria-mantu-kong.fly.dev"

echo "[fly-seed] Getting service role key..."
SERVICE_ROLE_KEY=$(fly secrets list -a aria-mantu-app -j | jq -r '.[] | select(.Name=="SUPABASE_SERVICE_ROLE_KEY") | .Value' 2>/dev/null || echo "")
if [ -z "$SERVICE_ROLE_KEY" ]; then
  echo "[fly-seed] ERROR: Could not read SUPABASE_SERVICE_ROLE_KEY from aria-mantu-app"
  echo "[fly-seed] Run: fly secrets list -a aria-mantu-app"
  exit 1
fi

echo "[fly-seed] Creating ${ADMIN_EMAIL} in GoTrue..."
code=$(curl -s -o /tmp/fly-seed.json -w "%{http_code}" -X POST \
  "${SUPABASE_URL}/auth/v1/admin/users" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${DEMO_ADMIN_PASSWORD}\",\"email_confirm\":true}")

case "$code" in
  200|201) echo "[fly-seed]   User created (HTTP ${code})" ;;
  422)     echo "[fly-seed]   User already exists (ok)" ;;
  *)       echo "[fly-seed]   ERROR (HTTP ${code}):"; cat /tmp/fly-seed.json 2>/dev/null; echo; exit 1 ;;
esac

echo "[fly-seed] Creating profile and workspace in Postgres..."
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

echo "[fly-seed] Done. Login credentials:"
echo "[fly-seed]   Email: ${ADMIN_EMAIL}"
echo "[fly-seed]   Password: <DEMO_ADMIN_PASSWORD you set>"
echo "[fly-seed]   URL: https://aria-mantu-app.fly.dev/"
```

Make it executable and commit.

## Verification

After Tony runs the seed script:

```bash
# 1. Test that user exists
curl -s "${SUPABASE_URL}/auth/v1/admin/users?email=eq.admin@hermes.local" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "apikey: ${SERVICE_ROLE_KEY}"
# Should return user array with admin@hermes.local

# 2. Test password login
# Open https://aria-mantu-app.fly.dev/
# Enter admin@hermes.local + password
# Should redirect to Command Center (not 0.0.0.0:3000 after ship 1)
```

## Next Ship After This

Ship 3: Workspace connection. The store expects to read/write workspace_state. If the REST schema is empty, the app will hang on "Connecting to your workspace".
