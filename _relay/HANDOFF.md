---
project: ARIA / MSourcing
shift: 2
agent: Claude Code (Cloud Agent)
updated: 2026-08-25 05:55 UTC
status: E2E ships + password docs complete, PR ready
---

## Current state

Branch: `cursor/fly-e2e-fixes-6014` (pushed)
PR: https://github.com/mysticalsin/aria-sourcing/pull/20 (open, ready for review)
Base: `integration/sourcing-enrichment-on-main`

All 4 E2E ships + password documentation committed and pushed:
1. 7417cd0: Auth redirects use public host (not 0.0.0.0:3000)
2. a25dd1f: scripts/seed-fly-admin.sh documents admin@hermes.local setup
3. fe197d3: docs/FLY_SETUP.md complete deployment checklist
4. 6e96cdf: docs/FLY_SETUP.md provider keys and campaign setup
5. 70130a5: _relay/HANDOFF.md updated for E2E ships
6. (latest): _relay/PLAN.md documents Fly admin password options

Test gate: CLEAN (npm run typecheck && npm run typecheck:tests && npm test)

## Done this shift

**Ships 1-4: E2E flow fixes (all documented in PR #20)**
- Created src/lib/public-origin.ts helper for Fly redirect fix
- Updated 4 auth routes to use publicOrigin instead of req.url.origin
- Created scripts/seed-fly-admin.sh for seeding admin@hermes.local
- Created docs/FLY_SETUP.md with complete deployment checklist
- Documented provider keys and campaign setup

**Password Recovery:**
- Searched repo for seed credentials per Tony's request
- Found documented default: `admindemo123` for `admin@hermes.local`
- Documented in DOCKER.md, docker-compose.yml, bootstrap scripts
- Provided 3 paths forward in PLAN.md:
  - Path A: Try admindemo123 (local dev default)
  - Path B: Enable demo login with DEMO_ADMIN_PASSWORD secret
  - Path C: Reset password via GoTrue admin API

## Blockers

None. Tony has multiple paths to access Fly admin account.

## Next steps

**For Tony (Password Recovery):**

1. **Quick test (Path A):** Try logging in at https://aria-mantu-app.fly.dev/ with:
   - Email: `admin@hermes.local`
   - Password: `admindemo123`

2. **If Path A fails (Path B):** Enable demo login:
   ```bash
   fly secrets set DEMO_ADMIN_PASSWORD=admindemo123 -a aria-mantu-app
   # Edit fly.app.toml line 20: NEXT_PUBLIC_ENABLE_DEMO_LOGIN = "true"
   fly deploy -c fly.app.toml -a aria-mantu-app
   # Then click "ENTER THE DEMO CONSOLE" at /login
   ```

3. **If password unknown (Path C):** Reset via GoTrue admin API (see PLAN.md)

**After Login Works:**

1. Review and merge PR #20
2. Deploy ship 1 to Fly: `fly deploy -c fly.app.toml -a aria-mantu-app`
3. Follow docs/FLY_SETUP.md:
   - Apply migrations to aria-mantu-db
   - Reload PostgREST schema cache
   - Set provider keys (ANTHROPIC_API_KEY, OPENAI_API_KEY)
4. Test E2E:
   - Login should redirect to Command Center (not 0.0.0.0:3000)
   - Create campaign via UI
   - Click "Source next batch" (should work after provider keys set)

## Decisions made (don't relitigate)

1. **Auth redirect strategy:** Use x-forwarded-host header with fallback to explicit env var.
2. **Login method:** Password login is primary. Demo login is optional.
3. **Documentation over code:** Ships 2-4 are pure documentation.
4. **No Fly deployment in this PR:** Tony must deploy manually.
5. **Password security:** Production demo login requires explicit DEMO_ADMIN_PASSWORD secret (no fallback to admindemo123).
6. **Three password paths:** Try default → enable demo login → reset via API. No brute force, no invented credentials.

## Watch out

1. **Password is `admindemo123` (not `admin`):** The one-click demo login UI shows "admin/admin", but that's resolved server-side to admin@hermes.local with the real password.
2. **Demo login route already exists:** `POST /api/auth/demo-login` works on Vercel. Enabling it on Fly only requires setting the secret + flag.
3. **Production security:** The route correctly requires DEMO_ADMIN_PASSWORD secret in production (no fallback to admindemo123).
4. **GOTRUE_SITE_URL secrets:** If Tony previously set GOTRUE_SITE_URL as a Fly secret, it will override fly.auth.toml [env].
5. **Migrations order:** Must apply ALL migrations before seeding.
6. **PostgREST reload:** After migrations, MUST notify PostgREST or restart it.
7. **Empty workspace:** After first login, workspace has 0 campaigns. Admin must create campaigns via UI.
8. **Provider keys required:** Without ANTHROPIC_API_KEY or OPENAI_API_KEY, /api/sourcing-agent returns 503.
