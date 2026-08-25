# PLAN: Ship 3 - Workspace Connection Past Loading Screen

**Basis:** fix/fly-auth-public-origin @ a25dd1f (after ship 2)
**Written:** 2026-08-25
**Scope:** Diagnose and fix "Connecting to your workspace" hang. No Fly deploy.

## Current State

Ships 1-2 committed:
- 7417cd0: Auth redirects use public host (not 0.0.0.0:3000)
- a25dd1f: scripts/seed-fly-admin.sh documents how to create admin@hermes.local

After Tony runs seed-fly-admin.sh and ship 1 deploys to Fly:
- Login works (password: admin@hermes.local)
- Auth callback redirects to https://aria-mantu-app.fly.dev/ (not 0.0.0.0:3000)
- App lands on "Connecting to your workspace" loading screen and hangs

## Problem

The app is stuck in `{phase: "loading", mode: "live"}` status. This happens when workspace hydration fails or never completes.

Hydration flow (src/lib/store.ts:520-566):
1. Call `loadRemoteState()` which queries `/rest/v1/workspace_state`
2. If the row exists, load the state
3. If the row does NOT exist (null), build an empty state with `buildLiveEmptyState()`
4. Set workspace status to `{phase: "ready", mode: "live"}`
5. First mutation (e.g. "Source next batch") triggers INSERT into workspace_state

The workspace_state table has RLS policies that require:
- `auth.uid()` to be set (user authenticated)
- A profile row exists linking that user to a workspace
- SELECT policy: `workspace_id = current_workspace_id()` (via profiles.workspace_id)
- INSERT/UPDATE policies: same + role in ('admin', 'member')

**Hypothesis:** One of two root causes:
1. Migrations not applied on Fly Postgres (tables don't exist)
2. PostgREST not reloaded after migrations (schema cache stale)

## Verification Steps for Tony

**Check 1: Do the tables exist?**

```bash
fly ssh console -a aria-mantu-db -C "psql -U postgres -d postgres" <<'SQL'
\dt public.*
SQL
```

Expected output: workspaces, profiles, workspace_state, agent_seats, campaigns, etc.

If NO tables: migrations were never applied. Run them (see Fix 1 below).

**Check 2: Can the seeded admin read their profile?**

```bash
# Get service role key
SERVICE_ROLE_KEY=$(fly secrets list -a aria-mantu-app -j | jq -r '.[] | select(.Name=="SUPABASE_SERVICE_ROLE_KEY") | .Value')

# Get admin user ID
ADMIN_USER_JSON=$(curl -s "https://aria-mantu-kong.fly.dev/auth/v1/admin/users?email=eq.admin@hermes.local" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "apikey: ${SERVICE_ROLE_KEY}")

echo "$ADMIN_USER_JSON" | jq '.[0].id'  # Should print UUID

# Get admin profile via REST
ADMIN_ID=$(echo "$ADMIN_USER_JSON" | jq -r '.[0].id')

curl -s "https://aria-mantu-kong.fly.dev/rest/v1/profiles?id=eq.${ADMIN_ID}" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "apikey: ${SERVICE_ROLE_KEY}"
```

Expected: Array with one profile (email: admin@hermes.local, role: admin, workspace_id: UUID).

If EMPTY: seed-fly-admin.sh didn't create the profile, or RLS is blocking even service_role.

**Check 3: Can PostgREST see the schema?**

```bash
curl -s "https://aria-mantu-kong.fly.dev/rest/v1/" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "apikey: ${SERVICE_ROLE_KEY}"
```

Expected: OpenAPI/Swagger schema listing tables (workspaces, profiles, workspace_state, campaigns, etc).

If `{"tables":[]}` or `{"message":"No schema found"}`: PostgREST cache is stale or PGRST_DB_SCHEMAS is wrong.

## Fixes

**Fix 1: Apply migrations (if Check 1 failed)**

```bash
# Option A: Apply via psql
fly ssh console -a aria-mantu-db -C "cat" < supabase/migrations/0001_init.sql | \
  fly ssh console -a aria-mantu-db -C "psql -U postgres -d postgres"

# Repeat for 0002..0010 (or combine them into one file)

# Option B: Use supabase CLI (if Tony has it locally)
# First, link to Fly DB:
#   supabase link --project-ref local --db-url postgres://postgres:<POSTGRES_PASSWORD>@aria-mantu-db.fly.dev:5432/postgres
# Then push:
#   supabase db push
```

After applying migrations, PostgREST must reload (see Fix 2).

**Fix 2: Reload PostgREST schema cache**

PostgREST caches the DB schema on startup. After migrations, notify it to reload:

```bash
fly ssh console -a aria-mantu-db -C "psql -U postgres -d postgres" <<'SQL'
notify pgrst, 'reload schema';
SQL
```

Or restart PostgREST:

```bash
fly restart -a aria-mantu-rest
```

**Fix 3: Verify seeded admin profile again**

After Fix 1-2, re-run Check 2. The profile should be visible via REST.

## In-Repo Change for Ship 3

Create docs/FLY_SETUP.md that documents the complete setup order:

1. Deploy all Fly apps (db, auth, rest, kong, app)
2. Set Fly secrets (SUPABASE_SERVICE_ROLE_KEY, GOTRUE_JWT_SECRET, etc.)
3. Apply migrations to aria-mantu-db (via psql or supabase CLI)
4. Reload PostgREST schema cache (notify pgrst or restart)
5. Run scripts/seed-fly-admin.sh to create admin@hermes.local
6. Test login at https://aria-mantu-app.fly.dev/

This is a prerequisite checklist, not code. Commit as documentation.

## Verification After Fix

After Tony applies migrations and reloads PostgREST:

1. Login at https://aria-mantu-app.fly.dev/ with admin@hermes.local
2. Should pass "Connecting to your workspace" and land on Command Center
3. Click "Source next batch" (will fail with different error, ship 4)
4. Browser console: no "workspace_state load failed" errors

## Next Ship After This

Ship 4: Fix 500s on `/api/hermes/chat` and `/api/sourcing-agent`. These require:
- Kong routing to the API endpoints (currently 404?)
- Live sourcing env vars (ANTHROPIC_API_KEY, etc.)
- Possibly seeded campaign/workspace data
