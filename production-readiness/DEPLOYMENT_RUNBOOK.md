# Deployment Runbook — Hermes Sourcing

**App:** Hermes Sourcing (MSourcing)
**Stack:** Next.js 14 App Router · React 18 · Supabase (Postgres + Auth) · Microsoft Entra · Vercel
**Last updated:** 2026-06-27

---

## Prerequisites

| Requirement | Where to check |
|---|---|
| Vercel CLI installed (`npm i -g vercel`) | `vercel --version` |
| Supabase CLI installed | `supabase --version` |
| Node ≥ 20 | `node --version` |
| GitHub Actions CI green on `main` | GitHub → Actions tab |
| All required env vars set in Vercel project | Vercel → Project → Settings → Environment Variables |

---

## 1. Pre-deployment gate (run every time)

All four checks must pass before a production deploy is triggered. Block the deploy if any fails.

```bash
# From the repo root:
npm run typecheck       # tsc --noEmit; must exit 0
npm run lint            # next lint; must be "No ESLint warnings or errors."
npm run test            # 21-suite test run; must be 0 failures
npm run test:security   # security-specific subset (faster); must be 0 failures
npm run build           # must complete without error
```

If `npm run build` fails, do NOT proceed. Fix the build first.

---

## 2. Database migrations (Supabase)

Migrations must be applied **before** the new code is live. The migration files live in `supabase/migrations/`. Apply in strict numeric order.

### 2a. Check current schema state

```bash
supabase db diff --schema public --linked
```

If the diff is empty, the DB is already at HEAD — skip to step 3.

### 2b. Apply pending migrations

```bash
# Recommended: use the Supabase CLI (linked to your project)
supabase db push

# Alternative: run the SQL files manually in Supabase SQL Editor.
# Order matters — each file depends on the previous:
# 0001_init.sql           → workspaces, profiles, workspace_state, RLS, ensure_workspace()
# 0002_fleet.sql          → agent_seats, suppression_list, outreach_ledger, claim_and_record() RPC
# 0003_api_keys.sql       → api_keys, column-level grants (secret hidden from authenticated role)
# 0004_email_connections.sql → email_connections, admin-only RLS
```

**IMPORTANT:** RLS must be enabled on every table listed above. Verify after each migration:

```sql
-- In Supabase SQL Editor, confirm RLS is ON:
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('workspaces','profiles','workspace_state','agent_seats',
                    'suppression_list','outreach_ledger','api_keys','email_connections');
-- Every row must show rowsecurity = true
```

### 2c. Verify RPC exists

```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name = 'claim_and_record';
-- Must return one row
```

---

## 3. Environment variables

All variables below must be set in Vercel **before** deploying. Production values only — never commit secrets to git.

| Variable | Scope | Required | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Yes | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Yes | Supabase → Project Settings → API → anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | Yes | Never expose to browser. Supabase → API → service_role |
| `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` | Public | Recommended | Locks sign-in to one domain (e.g. `mantu.com`) |
| `HERMES_API_URL` | Server | For AI drafts | Internal only; must not be a public internet URL |
| `HERMES_API_KEY` | Server | For AI drafts | Strong random token (≥32 chars) |
| `GOOGLE_CLIENT_ID` | Server | If Gmail seats used | |
| `GOOGLE_CLIENT_SECRET` | Server | If Gmail seats used | |
| `GOOGLE_REDIRECT_URI` | Server | If Gmail seats used | `https://<app>/auth/google/callback` |
| `MICROSOFT_CLIENT_ID` | Server | If Graph seats used | |
| `MICROSOFT_CLIENT_SECRET` | Server | If Graph seats used | |
| `MICROSOFT_REDIRECT_URI` | Server | If Graph seats used | `https://<app>/auth/microsoft/callback` |
| `RESEND_API_KEY` | Server | If Resend email used | |
| `SENDGRID_API_KEY` | Server | If SendGrid email used | |

Verify all variables are visible in Vercel before continuing:

```bash
vercel env ls --environment production
```

---

## 4. Deploy to Vercel

### Option A — Git push (recommended for main deployments)

```bash
git push origin main
```

Vercel's GitHub integration triggers a build automatically. Monitor in the Vercel dashboard.

### Option B — Vercel CLI (manual or hotfix)

```bash
vercel --prod
```

The CLI will print the deployment URL on completion.

### Build output to expect

```
Route (app)                              Size
┌ ○ /                                    ...
├ ○ /login                               ...
├ ○ /floor                               ...
...
✓ Build completed
```

Any `Error` or `Type error` output is a hard stop — rollback or fix before proceeding.

---

## 5. Post-deployment smoke check

Run these manually within 10 minutes of a production deploy. If any step fails, trigger the rollback runbook.

### 5a. Auth flow

1. Open `https://<app>/login` in an incognito window.
2. Click **Continue with Microsoft**.
3. Complete Entra SSO.
4. Confirm redirect to `/` or `/floor` (not an error page).
5. Check browser console — 0 errors expected.

### 5b. Critical routes

| Route | Expected | Pass? |
|---|---|---|
| `/` | Redirects to `/login` (if not authed) or dashboard | |
| `/floor` | Operations floor renders (2D grid + 3D toggle) | |
| `/fleet` | Fleet page loads, agent list visible | |
| `/settings` | Settings tabs render (requires admin role) | |
| `/chat` | Chat interface loads | |
| `/outreach` | Outreach panel loads | |

### 5c. Server-side key vault

```bash
# POST a test key (admin user's session cookie required):
curl -s -X POST https://<app>/api/keys \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie>" \
  -d '{"name":"smoke-test","provider":"test","value":"sk-test-1234567890"}'
# Expect: {"ok":true, "last4":"7890", ...}
# The 'secret' field must NOT appear in the response.
```

### 5d. Outreach dry-run guard

Navigate to `/outreach`, create a draft outreach. Confirm that:
- The human approval gate is visible before any send.
- No outreach is dispatched without explicit confirmation.
- If any seat is in dry-run mode, "Dry run" is displayed — no real email is sent.

### 5e. CSP headers

```bash
curl -sI https://<app>/ | grep -i content-security-policy
# Must return a non-empty CSP header with at least: default-src, script-src, connect-src
```

### 5f. Hermes proxy (if HERMES_API_URL is set)

```bash
curl -s -X POST https://<app>/api/hermes/chat \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie>" \
  -d '{"messages":[{"role":"user","content":"ping"}]}'
# Expect: streaming JSON or {"role":"assistant","content":"..."}
# Must NOT return a 401 or 500 on a valid session.
```

---

## 6. Notify team

Post in the team channel once smoke checks pass:

```
[DEPLOY] Hermes Sourcing deployed to production
Commit: <short SHA>
Deploy URL: https://<app>/
Smoke checks: PASS
Deployed by: <name>
Time: <UTC timestamp>
```

---

## Deployment checklist (quick reference)

- [ ] `npm run typecheck` → exit 0
- [ ] `npm run lint` → no errors
- [ ] `npm run test` → 0 failures
- [ ] `npm run build` → no errors
- [ ] DB migrations applied and RLS confirmed
- [ ] All required env vars set in Vercel
- [ ] `git push origin main` or `vercel --prod`
- [ ] Auth flow smoke check passed
- [ ] Critical routes all load
- [ ] CSP header present
- [ ] No console errors on `/floor`, `/fleet`, `/settings`
- [ ] Outreach approval gate visible
- [ ] Team notified
