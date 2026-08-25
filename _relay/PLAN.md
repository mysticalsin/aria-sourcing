# PLAN: Fix Fly Auth Redirect to Kill 0.0.0.0:3000

**Basis:** `integration/sourcing-enrichment-on-main` @ 58449e7 (before revert)
**Written:** 2026-08-25
**Scope:** ONE change to fix OAuth callback URLs. No deployment. No Polo.

## API Probe Evidence (Just Now)

**Fly** (aria-mantu-app.fly.dev):
- POST /api/auth/demo-login → 404 "Disabled in production" (demoLoginEnabled=false)
- Login uses supabase-js signInWithPassword against Kong https://aria-mantu-kong.fly.dev
- GoTrue v2.189.0, disable_signup true, all OAuth false
- **/auth/callback redirects to https://0.0.0.0:3000/** (BROKEN)
- **/auth/signout redirects to https://0.0.0.0:3000/login** (BROKEN)
- PostgREST OpenAPI shows same bogus 0.0.0.0:3000 host
- GET /api/health 200. /api/healthz and /api are 404 HTML
- Kong live routes: /auth/v1/* and /rest/v1/ behind key-auth

**Vercel** (aria-sourcing-demo.vercel.app):
- POST /api/auth/demo-login exists (demoLoginEnabled=true)
- Browser: ENTER THE DEMO CONSOLE works, lands on Command Center with aria_demo cookie

## Root Cause

GoTrue (aria-mantu-auth) is redirecting OAuth callbacks and signout to https://0.0.0.0:3000/ instead of https://aria-mantu-app.fly.dev. This makes password-based login impossible because the browser cannot navigate to 0.0.0.0:3000.

The redirect URL comes from GoTrue's GOTRUE_SITE_URL environment variable.

**In-Repo Config (fly.auth.toml lines 11-13):**
```toml
API_EXTERNAL_URL = "https://aria-mantu-kong.fly.dev"
GOTRUE_SITE_URL = "https://aria-mantu-app.fly.dev"
GOTRUE_URI_ALLOW_LIST = "https://aria-mantu-app.fly.dev/**"
```

These values are CORRECT in the repo. The 0.0.0.0:3000 behavior means either:

1. **A Fly secret named `GOTRUE_SITE_URL` is overriding the [env] value** (most likely)
2. The aria-mantu-auth app was deployed before these values were added to fly.auth.toml
3. GoTrue is falling back to a default constructed from HOSTNAME + PORT

## The Exact Fly Secrets to Check

Tony must run:
```bash
fly secrets list -a aria-mantu-auth
```

**If GOTRUE_SITE_URL or API_EXTERNAL_URL appear in the secrets list:**
```bash
fly secrets unset GOTRUE_SITE_URL API_EXTERNAL_URL -a aria-mantu-auth
```

Then redeploy aria-mantu-auth:
```bash
fly deploy -c fly.auth.toml -a aria-mantu-auth
```

**Expected secrets for aria-mantu-auth (from fly.auth.toml line 23-24):**
- GOTRUE_JWT_SECRET (should equal FLY_JWT_SECRET)
- GOTRUE_DB_DATABASE_URL (postgres connection string)

GOTRUE_SITE_URL and API_EXTERNAL_URL should NOT be secrets. They are public URLs and belong in the [env] section of fly.auth.toml, which they already are.

## In-Repo Change: Add Validation Comment

No code change needed. The in-repo config is already correct. But add a comment to fly.auth.toml to prevent future secret override:

After line 13, add:
```toml
# IMPORTANT: GOTRUE_SITE_URL and API_EXTERNAL_URL must NOT be Fly secrets.
# Secrets override [env] values. If redirects go to 0.0.0.0:3000, check:
# fly secrets list -a aria-mantu-auth
# If either appears, unset it: fly secrets unset GOTRUE_SITE_URL -a aria-mantu-auth
```

This documents the issue for future maintainers.

## PostgREST OpenAPI Fix

PostgREST (aria-mantu-rest) also shows 0.0.0.0:3000 in its OpenAPI spec. PostgREST doesn't have a SITE_URL env var. The OpenAPI host comes from the incoming request's Host header or a proxy header.

This is likely a secondary symptom. Once GoTrue redirects work, this becomes irrelevant because the REST API is internal-only (no external routing in fly.rest.toml). The OpenAPI endpoint is not used in production.

If it needs fixing after GoTrue works, the solution is to add PGRST_OPENAPI_SERVER_PROXY_URI to fly.rest.toml [env], but that can wait.

## Verification Plan

After Tony unsets any secret overrides and redeploys aria-mantu-auth:

1. Test signout redirect:
   ```bash
   curl -I https://aria-mantu-kong.fly.dev/auth/v1/logout
   ```
   Should redirect to https://aria-mantu-app.fly.dev/login (not 0.0.0.0:3000)

2. Test password login flow:
   - Open https://aria-mantu-app.fly.dev/
   - Should redirect to /login
   - Enter email + password (if demo login is still disabled)
   - Submit
   - GoTrue should redirect back to https://aria-mantu-app.fly.dev/ (not 0.0.0.0:3000)
   - Browser should land on dashboard

3. If step 2 fails with "no such user":
   - Demo login is still disabled (NEXT_PUBLIC_ENABLE_DEMO_LOGIN=false in fly.app.toml line 20)
   - User needs a real account in GoTrue or demo login must be enabled
   - That is a SEPARATE issue from the 0.0.0.0:3000 redirect

## Why Not Enable Demo Login in This Change

The user explicitly said: "Do not enable demo login on Fly in this change unless the site-URL fix is impossible without it."

The site-URL fix is possible and independent of demo login. The 0.0.0.0:3000 redirect breaks ALL auth flows (password, OAuth, demo). Fixing the redirect unblocks password-based login. Then demo login can be enabled separately if needed.

## Implementation

1. Revert commit 58449e7 (the demo login enable)
2. Add the validation comment to fly.auth.toml after line 13
3. Commit: "docs(fly): add GOTRUE_SITE_URL secret override warning"
4. Tony: check and unset secrets, redeploy aria-mantu-auth
5. Verify redirects go to aria-mantu-app.fly.dev not 0.0.0.0:3000
