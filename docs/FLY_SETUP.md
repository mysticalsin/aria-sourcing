# Fly Deployment Setup Checklist

Complete setup order for the Aria self-hosted stack on Fly.io (aria-mantu-*.fly.dev).

## Prerequisites

- Fly CLI (`fly`) installed and authenticated to the Fly org
- Local `psql` (optional, for direct DB access)
- Repository cloned locally

## 1. Deploy All Fly Apps

Deploy each app in dependency order (DB first, then services that depend on it):

```bash
# 1. Postgres (base for all services)
fly deploy -c fly.db.toml -a aria-mantu-db

# 2. GoTrue (auth, needs DB)
fly deploy -c fly.auth.toml -a aria-mantu-auth

# 3. PostgREST (needs DB)
fly deploy -c fly.rest.toml -a aria-mantu-rest

# 4. Kong (API gateway, routes to auth/rest)
fly deploy -c fly.kong.toml -a aria-mantu-kong

# 5. Next.js app (needs all services)
fly deploy -c fly.app.toml -a aria-mantu-app
```

## 2. Set Fly Secrets

Each app needs specific secrets. Set them before deployment or immediately after:

```bash
# aria-mantu-db
fly secrets set POSTGRES_PASSWORD=<strong-password> -a aria-mantu-db

# aria-mantu-auth (GoTrue)
fly secrets set GOTRUE_JWT_SECRET=<strong-jwt-secret> \
  GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:<auth-db-password>@aria-mantu-db.internal:5432/postgres \
  -a aria-mantu-auth

# aria-mantu-rest (PostgREST)
fly secrets set PGRST_JWT_SECRET=<same-jwt-secret> \
  PGRST_APP_SETTINGS_JWT_SECRET=<same-jwt-secret> \
  PGRST_DB_URI=postgres://authenticator:<rest-db-password>@aria-mantu-db.internal:5432/postgres \
  -a aria-mantu-rest

# aria-mantu-kong
fly secrets set FLY_JWT_SECRET=<same-jwt-secret> -a aria-mantu-kong

# aria-mantu-app (Next.js)
fly secrets set SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
  SUPABASE_ANON_KEY=<anon-key> \
  NEXTAUTH_SECRET=<nextauth-secret> \
  -a aria-mantu-app

# Optional: enable demo login (after seeding admin@hermes.local)
# fly secrets set DEMO_ADMIN_PASSWORD=<same-as-seed-script> -a aria-mantu-app
```

**IMPORTANT:** All `JWT_SECRET` values must match. Generate with:

```bash
openssl rand -base64 32
```

**Service Role Key:** Generate with Supabase CLI or manually (JWT signed with the JWT_SECRET, role=service_role).

**Anon Key:** Generate with Supabase CLI or manually (JWT signed with the JWT_SECRET, role=anon).

## 3. Apply Database Migrations

The Fly Postgres instance is empty on first deploy. Apply all migrations in order:

```bash
# Option A: Via fly ssh console (direct psql)
for migration in supabase/migrations/*.sql; do
  echo "Applying $migration..."
  fly ssh console -a aria-mantu-db -C "psql -U postgres -d postgres" < "$migration"
done

# Option B: Combine all migrations into one file
cat supabase/migrations/*.sql > /tmp/all-migrations.sql
fly ssh console -a aria-mantu-db -C "psql -U postgres -d postgres" < /tmp/all-migrations.sql

# Option C: Use supabase CLI (if installed)
# 1. Link to Fly DB:
POSTGRES_PASSWORD=$(fly secrets list -a aria-mantu-db -j | jq -r '.[] | select(.Name=="POSTGRES_PASSWORD") | .Value')
supabase link --project-ref fly-aria-mantu --db-url "postgres://postgres:${POSTGRES_PASSWORD}@aria-mantu-db.fly.dev:5432/postgres"
# 2. Push:
supabase db push
```

Verify migrations applied:

```bash
fly ssh console -a aria-mantu-db -C "psql -U postgres -d postgres" <<'SQL'
\dt public.*
SQL
```

Expected output: `workspaces`, `profiles`, `workspace_state`, `campaigns`, `agent_seats`, etc.

## 4. Reload PostgREST Schema Cache

PostgREST caches the DB schema on startup. After applying migrations, force a reload:

```bash
# Option A: NOTIFY (faster, no downtime)
fly ssh console -a aria-mantu-db -C "psql -U postgres -d postgres" <<'SQL'
notify pgrst, 'reload schema';
SQL

# Option B: Restart PostgREST (slower, brief downtime)
fly restart -a aria-mantu-rest
```

Verify PostgREST sees the schema:

```bash
SERVICE_ROLE_KEY=$(fly secrets list -a aria-mantu-app -j | jq -r '.[] | select(.Name=="SUPABASE_SERVICE_ROLE_KEY") | .Value')

curl -s "https://aria-mantu-kong.fly.dev/rest/v1/" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "apikey: ${SERVICE_ROLE_KEY}" | jq '.definitions | keys'
```

Expected: Array of table names (workspaces, profiles, workspace_state, etc.).

## 5. Seed Admin User

Create the initial admin@hermes.local user for password login:

```bash
# Set a strong password (will be the real login password)
export DEMO_ADMIN_PASSWORD="<strong-password>"

# Run the seed script
./scripts/seed-fly-admin.sh
```

This creates:
- GoTrue user: admin@hermes.local (email + password)
- Workspace: "Hermes Workspace" (allowed_domain: hermes.local)
- Profile: admin@hermes.local → admin role in Hermes Workspace

Verify the user exists:

```bash
SERVICE_ROLE_KEY=$(fly secrets list -a aria-mantu-app -j | jq -r '.[] | select(.Name=="SUPABASE_SERVICE_ROLE_KEY") | .Value')

curl -s "https://aria-mantu-kong.fly.dev/auth/v1/admin/users?email=eq.admin@hermes.local" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "apikey: ${SERVICE_ROLE_KEY}" | jq '.[0].email'
```

Expected: `"admin@hermes.local"`

## 6. Test Login

Open https://aria-mantu-app.fly.dev/ in a browser:

1. Click "Sign in"
2. Enter: `admin@hermes.local`
3. Password: `<DEMO_ADMIN_PASSWORD from step 5>`
4. Should redirect back to https://aria-mantu-app.fly.dev/ (NOT 0.0.0.0:3000)
5. Should pass "Connecting to your workspace" and land on Command Center

If login works but workspace hangs on "Connecting to your workspace":
- Check PostgREST schema reload (step 4)
- Check browser console for "workspace_state load failed" errors
- Verify profile exists with Check 2 from PLAN.md

## 7. Configure AI Provider Keys

Live sourcing and chat require at least one AI provider key. Without keys, routes fall back to deterministic mocks or return 503 errors.

```bash
# Set provider keys (at least one required)
fly secrets set ANTHROPIC_API_KEY=<your-anthropic-key> -a aria-mantu-app
fly secrets set OPENAI_API_KEY=<your-openai-key> -a aria-mantu-app

# Optional: Tavily for web sourcing
fly secrets set TAVILY_API_KEY=<your-tavily-key> -a aria-mantu-app

# Restart app to pick up new secrets
fly restart -a aria-mantu-app
```

**Which keys do I need?**
- `/api/sourcing-agent` (live candidate sourcing) uses Anthropic by default
- `/api/hermes/chat` (AI chat) prefers OpenAI, falls back to Anthropic
- TAVILY_API_KEY is optional but improves sourcing quality

Verify keys are set:

```bash
fly secrets list -a aria-mantu-app
```

Expected: ANTHROPIC_API_KEY, OPENAI_API_KEY (and optionally TAVILY_API_KEY).

## 8. Create First Campaign

After login, the workspace is EMPTY (no campaigns, no candidates). Create a campaign to test sourcing:

1. Open https://aria-mantu-app.fly.dev/
2. Login with admin@hermes.local
3. Command Center should show (empty state)
4. Click "New Campaign" (or create via UI)
5. Fill in job details (title, skills, sourcing strategy)
6. Activate campaign (status: "Sourcing")
7. Click "Source next batch"
8. Should call `/api/sourcing-agent` and return candidates

If sourcing fails, check:
- Provider keys set (step 7)
- Campaign status is "Sourcing" or "Outreach"
- Browser console for error codes (CAMPAIGN_NOT_FOUND, SOURCING_AGENT_NOT_CONFIGURED, etc.)

## 9. Optional: Enable Demo Login

If you want the one-click "ENTER THE DEMO CONSOLE" button (like Vercel demo):

```bash
# 1. Set the same password as a Fly secret
fly secrets set DEMO_ADMIN_PASSWORD=<same-password-from-step-5> -a aria-mantu-app

# 2. Edit fly.app.toml line 20:
NEXT_PUBLIC_ENABLE_DEMO_LOGIN = "true"

# 3. Redeploy
fly deploy -c fly.app.toml -a aria-mantu-app
```

After this, the login page shows "ENTER THE DEMO CONSOLE" which auto-fills admin/admin and submits (backend resolves to admin@hermes.local with DEMO_ADMIN_PASSWORD).

## Common Issues

**"Connecting to your workspace" hangs:**
- Migrations not applied (step 3)
- PostgREST schema cache stale (step 4)
- Profile not created (step 5)

**Login redirects to 0.0.0.0:3000:**
- Ship 1 (auth redirect fix) not deployed yet

**401 "Sign in to use this demo API." on /api/healthz:**
- Expected. The Next.js middleware requires auth for all /api/* routes except /api/health and /api/ready.

**500 or 503 on /api/sourcing-agent:**
- Provider keys missing (step 7)
- Campaign not found (step 8)
- Migrations incomplete (step 3)

## Next Steps

After E2E works (login → workspace → sourcing):
- Configure email seats for outbound (agent_seats table)
- Set up cron for daily outreach dispatch (CRON_SECRET)
- Configure external integrations (Google Drive, Microsoft 365, etc.)
- Monitor logs: `fly logs -a aria-mantu-app`
