# PLAN: Unblock Aria Sourcing End-to-End on Both Hosts

**Basis:** `integration/sourcing-enrichment-on-main` @ current HEAD
**Written:** 2026-08-25
**Scope:** DISCOVER + PLAN ONLY. No product changes. No deployment.

## Auth Model

**Vercel Demo** (aria-sourcing-demo.vercel.app):
- Supabase Auth (GoTrue) with hosted Supabase project
- Demo login: admin/admin resolves SERVER-SIDE to admin@hermes.local account using DEMO_ADMIN_PASSWORD
- Middleware (src/proxy.ts) gates all routes with HMAC-signed demo cookie or Supabase session
- Session persists via sb-auth-token httpOnly cookie
- RLS enforces workspace tenancy in Postgres

**Fly Production** (aria-mantu-app.fly.dev + kong):
- Same Supabase Auth but self-hosted on Fly
- Kong gateway at aria-mantu-kong.fly.dev proxies /auth/v1, /rest/v1 with key-auth
- Next.js app on aria-mantu-app.fly.dev uses internal kong.internal:8000 for server-side calls
- Kong /healthz endpoint (request-termination plugin) returns 200 "ok" without backend
- App /api/health returns JSON health check

## Env Vars Required

**Vercel Minimum for E2E:**
```
NEXT_PUBLIC_SUPABASE_URL=<hosted supabase project URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true
DEMO_ADMIN_PASSWORD=<strong password matching seeded admin@hermes.local>
DATA_ENCRYPTION_KEY=<base64 32-byte key>
```

**Fly Minimum for E2E:**
- Same as Vercel but NEXT_PUBLIC_SUPABASE_URL points to internal Kong
- SUPABASE_URL overrides to http://aria-mantu-kong.internal:8000
- FLY_SUPABASE_ANON_KEY and FLY_SUPABASE_SERVICE_KEY injected to Kong
- NEXT_PUBLIC_ENABLE_DEMO_LOGIN typically false (production Supabase auth)

## Fly vs Vercel Differences

| Aspect | Vercel | Fly |
|--------|--------|-----|
| Supabase | Hosted cloud project | Self-hosted (auth, rest, db, kong) |
| /api/healthz | 401 "Sign in to use this demo API." from middleware (not in isPublicServiceApi) | 200 "ok" from Kong request-termination plugin |
| /api/health | 200 JSON {"ok":true,"status":"healthy",...} | 200 JSON (same) |
| Demo login | admin/admin enabled via NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true | Typically disabled (real Supabase accounts) |
| Session cookie | sb-auth-token set by Next.js middleware | Same, shared over Fly 6PN |
| API auth | Middleware checks demo cookie or Supabase session | Same middleware |

## The Single First E2E Gap

**Where:** Vercel demo path from dashboard "Source next batch" click to live candidate sourcing.

**Root Cause:** The Vercel demo is configured as a LIVE workspace (supabaseEnabled=true) but sourcing requires database state that may not exist or be properly seeded.

**Observed Behavior:**
1. User lands on / → 307 to /login (both hosts work)
2. /login → click "Enter the demo console" → POST /api/auth/demo-login
3. Demo login succeeds if:
   - DEMO_ADMIN_PASSWORD matches seeded admin@hermes.local password
   - admin@hermes.local exists in Supabase Auth
   - User has profile row with role='admin'
   - Workspace exists and is linked to user
4. Dashboard loads → user clicks "Source next batch"
5. Client calls actions.sourceNextBatch(campaignId)
6. Store logic checks: syntheticSourcingAllowed() returns !supabaseEnabled → FALSE on Vercel
7. Because demoSourcing=false, store calls sourceReviewedCampaignBatch()
8. That function calls POST /api/sourcing-agent with campaign ID
9. /api/sourcing-agent endpoint:
   - Line 214: Requires supabaseEnabled (✓ true on Vercel)
   - Line 226-233: Requires authenticated Supabase session (✓ if login worked)
   - Line 235-244: Requires user role='admin' with 'source' permission + workspace_id from DB
   - Line 271: Calls readWorkspace() → queries workspace_state table for campaign
   - Returns 404 if campaign not found in DB

**First Break Point:** The workspace_state table on the Vercel demo's hosted Supabase project likely:
- Does NOT contain the campaign created in-browser (it's in localStorage only), OR
- Does NOT contain any workspace_state row for the demo user, OR
- The admin@hermes.local account was not properly seeded with a workspace

**Evidence:**
- src/lib/store.ts line 911: syntheticSourcingAllowed = () => !supabaseEnabled
- Vercel has supabaseEnabled=true (NEXT_PUBLIC_SUPABASE_URL is set)
- Therefore browser state is LIVE mode, not demo mode
- LIVE mode expects ALL state in Supabase Postgres
- But the dashboard likely creates campaigns in-browser using localStorage
- Those campaigns never sync to the database because the store's commitPersisted path requires a valid workspace

**Fly Status:** Fly production has the same code path but:
- Runs with real Supabase accounts (not demo login)
- Has migrations applied via aria-mantu-bootstrap
- Has workspace_state rows populated by real users
- /api/sourcing-agent would work IF user is authenticated and workspace exists

## ONE Logical Next Change to Unblock E2E

**Change:** Make Vercel demo behave as a true demo (synthetic sourcing) rather than a misconfigured live workspace.

**Option A (Recommended): Disable Supabase on Vercel demo**

Remove NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY from Vercel env vars. This forces:
- supabaseEnabled → false
- syntheticSourcingAllowed → true
- demoSourcing → true in sourceNextBatch
- Sourcing calls /api/source with platform=GitHub
- /api/source line 136: supabaseEnabled check is false, so it allows demo sourcing
- Candidates stored in localStorage only
- No database required

**Option B: Properly seed Vercel demo workspace**

Keep Supabase enabled but ensure:
1. admin@hermes.local exists with correct password
2. Profile row with role='admin' and workspace_id='<uuid>'
3. workspace_state row with that workspace_id containing seeded campaigns
4. Seed script: supabase/seed-admin.sql (already exists)
5. Apply migrations: supabase db push or paste each file in order

**Option C: Hybrid demo mode with Supabase**

Add logic to detect "demo with Supabase" (NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true AND supabaseEnabled=true) and:
- Force syntheticSourcingAllowed to return true
- Skip database reads in sourceNextBatch
- Use localStorage for all state even when Supabase is configured

**Recommendation:** Option A (disable Supabase on Vercel demo) is cleanest. The Vercel demo is explicitly positioned as a public synthetic-data demo per DEPLOY_VERCEL_DEMO.md. Removing Supabase env vars makes the demo path coherent: admin/admin → localStorage → /api/source demo GitHub search → no database dependencies.

**Alternative (if Supabase MUST stay):** Option B requires seeding the database with at least one workspace and one campaign in the workspace_state JSON. The seed-admin.sql script exists but does not create workspace_state rows. A new seed-workspace-state.sql would be needed.

**Verification Plan (after change):**
1. Deploy change to Vercel preview
2. Open preview URL → should redirect to /login
3. Click "Enter the demo console" → should reach dashboard
4. Dashboard should show seed campaigns (from localStorage or DB depending on option)
5. Click "Source next batch" → should return candidates without 404/503
6. Check browser network tab: POST /api/source should return 200 with users array (Option A) or POST /api/sourcing-agent should return 200 with candidates array (Option B)

## Kong /api/healthz Note

The /api/healthz path is NOT a Next.js route. On Fly, Kong handles it with a request-termination plugin that returns 200 "ok". On Vercel (no Kong), the middleware (src/proxy.ts) intercepts /api/* routes. Because /api/healthz is not in the isPublicServiceApi() list, it falls through to the demo session check and returns 401 if no valid session exists. This is NOT the E2E blocker. The E2E blocker is the sourcing action database dependency.

To fix the Vercel /api/healthz 401: add "/api/healthz" to isPublicServiceApi() in src/proxy.ts line 22-29. But this is a nit, not the E2E gap.

## Next Steps (outside scope of this plan)

1. Choose Option A, B, or C above
2. Implement the chosen change
3. Deploy to Vercel preview
4. Verify E2E: login → dashboard → source → candidates appear
5. If Option B: document seed-workspace-state.sql and update DEPLOY_VERCEL_DEMO.md
6. If Option A: update DEPLOY_VERCEL_DEMO.md to remove Supabase env vars from step 3
7. Test Fly E2E separately (different auth path, same sourcing logic)
