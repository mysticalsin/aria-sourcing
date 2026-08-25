# PLAN: Enable Demo Login on Fly to Match Vercel

**Basis:** `integration/sourcing-enrichment-on-main` @ c5977bb
**Written:** 2026-08-25
**Scope:** ONE change to unblock Fly auth. No deployment. No Polo.

## Observed Behavior (Browser Proof)

**Vercel** (aria-sourcing-demo.vercel.app):
- /login shows "ENTER THE DEMO CONSOLE" button
- Prefilled admin/admin form visible but not required
- Click button → signs in without password prompt → Command Center loads (4/5 integrations, 3 seeded campaigns)

**Fly** (aria-mantu-app.fly.dev):
- /login shows "SIGN IN WITH EMAIL" button
- Username/password fields are empty, no prefill
- No signup, no password reset, no SSO, no magic link
- A new user cannot get in

## Root Cause

fly.app.toml line 20:
```
NEXT_PUBLIC_ENABLE_DEMO_LOGIN = "false"
```

This is a build-time argument. When "false", the login page shows "Sign in with email" and requires a real Supabase account. When "true", it shows "Enter the demo console" and enables one-click admin/admin login.

Vercel has this set to "true" in its environment variables.
Fly has it hardcoded to "false" in fly.app.toml [build.args].

## The Auth Flow When NEXT_PUBLIC_ENABLE_DEMO_LOGIN = "true"

From src/app/login/page.tsx lines 144-162:

1. User clicks the primary CTA button
2. handleCTA() checks: if (demoLoginEnabled) void runDemoLogin()
3. runDemoLogin() POSTs to /api/auth/demo-login with {username:"admin", password:"admin"}
4. Server route (src/app/api/auth/demo-login/route.ts):
   - Line 66-67: Resolves demoPassword from process.env.DEMO_ADMIN_PASSWORD
   - Line 85-88: Signs in to Supabase with admin@hermes.local + demoPassword
   - Returns ok:true if successful
5. Client redirects to dashboard

The admin/admin shortcut is CLIENT CONVENIENCE only. The server resolves it to a REAL Supabase account (admin@hermes.local) using DEMO_ADMIN_PASSWORD as the actual password. The well-known "admin" password never reaches the database.

## Required Changes

### 1. In-Repo: fly.app.toml

Change line 20 from:
```
NEXT_PUBLIC_ENABLE_DEMO_LOGIN    = "false"                       # real tenant: OFF → strict fail-closed
```

To:
```
NEXT_PUBLIC_ENABLE_DEMO_LOGIN    = "true"                        # public demo: ON → one-click admin/admin
```

Update comment on line 38 from:
```
# Do NOT set NEXT_PUBLIC_ENABLE_DEMO_LOGIN / DEMO_ADMIN_PASSWORD on a real tenant.
```

To:
```
# Demo deployment: NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true + DEMO_ADMIN_PASSWORD secret required.
```

### 2. Fly Secret (Tony Must Set)

```bash
fly secrets set DEMO_ADMIN_PASSWORD=<strong-password> -a aria-mantu-app
```

This password MUST match the password for the admin@hermes.local account in aria-mantu-auth (GoTrue).

### 3. Database Seeding (If Not Already Done)

The Fly Supabase must have:

**GoTrue (aria-mantu-auth):**
- User: admin@hermes.local
- Password: <same as DEMO_ADMIN_PASSWORD>
- Email confirmed: true

**Postgres (aria-mantu-db):**
- Profile row: {user_id: <admin uuid>, role: 'admin', workspace_id: <workspace uuid>}
- workspace_state row: {workspace_id: <workspace uuid>, state: <JSON with seeded campaigns>}

Script location: supabase/seed-admin.sql (creates profile, NOT the GoTrue user)

To seed GoTrue user, either:
- Use Supabase Dashboard (not accessible from here)
- Use goTrue API directly (requires admin JWT)
- Add to bootstrap workflow (aria-mantu-bootstrap)

## Verification Plan

After Tony sets DEMO_ADMIN_PASSWORD and the change is deployed:

1. Open https://aria-mantu-app.fly.dev/
2. Should redirect to /login
3. Primary button should read "ENTER THE DEMO CONSOLE"
4. Click button (no password prompt)
5. Should land on Command Center dashboard
6. If it returns 500 "Demo login failed", the DEMO_ADMIN_PASSWORD does not match the database password
7. If it returns 404, admin@hermes.local does not exist in GoTrue
8. If it returns 401 or workspace errors, the profile/workspace rows are missing

## Security Note

From fly.app.toml line 20 comment and line 38: the original intent was "real tenant: OFF → strict fail-closed. Do NOT set NEXT_PUBLIC_ENABLE_DEMO_LOGIN / DEMO_ADMIN_PASSWORD on a real tenant."

This change turns aria-mantu-app.fly.dev into a public demo like Vercel, not a production tenant. If the intent is to keep Fly as production and ALSO offer a demo, a separate Fly app (aria-mantu-demo) with its own fly.demo.toml would be needed.

## Next Steps After This Fix

Once demo login works on Fly, the NEXT E2E gap will be the same one from the previous PLAN.md: sourcing from the dashboard.

Fly will have the same issue as Vercel: if supabaseEnabled=true, the store expects campaigns in workspace_state, but the demo creates them in localStorage only. The fix from the previous plan (Option A, B, or C) will apply to Fly as well.

However, Fly has a better starting position: if the workspace_state table is properly seeded with campaigns, sourcing will work immediately because Fly has the full self-hosted Supabase stack and the sourcing-agent route will find the campaign.

## Implementation

Change fly.app.toml line 20 and line 38 comment as documented above. Commit with message:

```
feat(auth): enable demo login on Fly to match Vercel

fly.app.toml: Set NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true to show
"Enter the demo console" button on aria-mantu-app.fly.dev.

Requires Tony to set: fly secrets set DEMO_ADMIN_PASSWORD=<password>
Requires database: admin@hermes.local account in GoTrue with that password
```

Do not deploy. Tony will deploy after setting the secret and seeding the database.
