# PLAN: Fly Login Credentials

**Basis:** cursor/fly-e2e-fixes-6014 @ 70130a5 (all E2E ships committed)
**Written:** 2026-08-25
**Scope:** Find or reset Fly admin password. No code changes needed.

## Problem

Tony does not remember the Fly admin password for `admin@hermes.local`. Need to find documented credentials or provide reset path.

## Findings

Searched repo for seed passwords. Found documented default in local docker stack:

**Email:** `admin@hermes.local`
**Password:** `admindemo123`

This is the **local development default** documented in:
1. `DOCKER.md` line 16: "admin@hermes.local / admindemo123"
2. `docker-compose.yml` line 27: `demo_admin_pw: &demo_admin_pw "admindemo123"`
3. `docker/bootstrap/run.sh` line 36: `ADMIN_PW="${DEMO_ADMIN_PASSWORD:-admindemo123}"`
4. `src/app/api/auth/demo-login/route.ts` line 67: Falls back to `admindemo123` for non-production

## Three Paths Forward

### Path A: Try the Default Password (Quick)

If Tony (or a previous script) seeded Fly with the local dev default:

**Login URL:** https://aria-mantu-app.fly.dev/
**Email:** `admin@hermes.local`
**Password:** `admindemo123`

This works if:
- Tony ran scripts/seed-fly-admin.sh with `DEMO_ADMIN_PASSWORD=admindemo123`
- Or if Fly was seeded with the docker-compose default

### Path B: Enable Demo Login (Already in Repo)

The demo-login route (`POST /api/auth/demo-login`) already exists and works on Vercel. Enable it on Fly:

**Step 1: Set the password as a secret**

```bash
# If Tony knows the password (or wants to set it to admindemo123)
fly secrets set DEMO_ADMIN_PASSWORD=admindemo123 -a aria-mantu-app
```

**Step 2: Enable the demo login flag**

Edit `fly.app.toml` line 20:

```toml
NEXT_PUBLIC_ENABLE_DEMO_LOGIN = "true"
```

**Step 3: Redeploy**

```bash
fly deploy -c fly.app.toml -a aria-mantu-app
```

**Step 4: Login**

Open https://aria-mantu-app.fly.dev/login and click **ENTER THE DEMO CONSOLE**.

This auto-fills `admin` / `admin` and signs in via `/api/auth/demo-login`, which resolves to `admin@hermes.local` with `DEMO_ADMIN_PASSWORD`.

### Path C: Reset Password via GoTrue Admin API (If Password Unknown)

If the password is unknown and not `admindemo123`, reset it:

**Step 1: Get service role key**

```bash
SERVICE_ROLE_KEY=$(fly secrets list -a aria-mantu-app -j | jq -r '.[] | select(.Name=="SUPABASE_SERVICE_ROLE_KEY") | .Value')
```

**Step 2: Get admin user ID**

```bash
ADMIN_USER_JSON=$(curl -s "https://aria-mantu-kong.fly.dev/auth/v1/admin/users?email=eq.admin@hermes.local" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "apikey: ${SERVICE_ROLE_KEY}")

ADMIN_ID=$(echo "$ADMIN_USER_JSON" | jq -r '.[0].id')
echo "Admin user ID: $ADMIN_ID"
```

**Step 3: Reset password**

```bash
# Set new password (24+ characters for production)
NEW_PASSWORD="<strong-new-password>"

curl -X PUT "https://aria-mantu-kong.fly.dev/auth/v1/admin/users/${ADMIN_ID}" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"${NEW_PASSWORD}\"}"
```

**Step 4: Login**

Open https://aria-mantu-app.fly.dev/ and sign in with:
- Email: `admin@hermes.local`
- Password: `<NEW_PASSWORD from step 3>`

## Recommendation

**Try Path A first** (login with `admindemo123`). If that fails, **use Path B** (enable demo login with `admindemo123` as the secret). If Tony wants a different password, use Path C to reset.

## Verification

After login (any path):

```bash
# 1. Test auth redirect (no 0.0.0.0)
curl -sI https://aria-mantu-app.fly.dev/auth/callback | grep -i location
# Should NOT contain 0.0.0.0

# 2. Browser test
# Open https://aria-mantu-app.fly.dev/
# Login with admin@hermes.local + password
# Should land on Command Center (not stuck on "Connecting to your workspace")
```

## Next Steps After Login Works

Continue with ships 3-4 setup from docs/FLY_SETUP.md:
1. Apply migrations to aria-mantu-db
2. Reload PostgREST schema cache
3. Set provider keys (ANTHROPIC_API_KEY, OPENAI_API_KEY)
4. Create first campaign via UI
5. Test sourcing

## No Code Changes Required

All three paths use existing code. The demo login route already has the fallback to `admindemo123` for non-production, and production requires `DEMO_ADMIN_PASSWORD` secret (which is the correct security posture).
