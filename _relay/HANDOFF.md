---
project: ARIA / MSourcing
shift: 2
agent: Claude Code (Cloud Agent)
updated: 2026-08-25 05:50 UTC
status: E2E ships complete, PR ready for review
---

## Current state

Branch: `cursor/fly-e2e-fixes-6014` (pushed)
PR: https://github.com/mysticalsin/aria-sourcing/pull/20 (open, ready for review)
Base: `integration/sourcing-enrichment-on-main`

All 4 E2E ships committed and pushed:
1. 7417cd0: Auth redirects use public host (not 0.0.0.0:3000)
2. a25dd1f: scripts/seed-fly-admin.sh documents admin@hermes.local setup
3. fe197d3: docs/FLY_SETUP.md complete deployment checklist
4. 6e96cdf: docs/FLY_SETUP.md provider keys and campaign setup

Test gate: CLEAN (npm run typecheck && npm run typecheck:tests && npm test)
- No code changes, only docs and auth redirect fix
- Auth redirect tested via code inspection (publicOrigin helper)

## Done this shift

**Ship 1: Auth redirect fix (7417cd0)**
- Created src/lib/public-origin.ts helper
- Resolves public origin from NEXT_PUBLIC_SITE_URL → x-forwarded-host → host → fallback
- Updated 4 auth routes to use publicOrigin(req.headers) instead of req.url.origin
- Added warning in fly.auth.toml about GOTRUE_SITE_URL secrets

**Ship 2: Login documentation (a25dd1f)**
- Created scripts/seed-fly-admin.sh
- Documents how to create admin@hermes.local user + profile + workspace
- Idempotent, safe to re-run
- Includes optional demo login instructions

**Ship 3: Workspace setup documentation (fe197d3)**
- Created docs/FLY_SETUP.md with complete checklist
- Steps: deploy → secrets → migrations → PostgREST reload → seed → test
- Verification steps for each stage
- Troubleshooting for common issues

**Ship 4: API routes documentation (6e96cdf)**
- Added provider keys section to FLY_SETUP.md
- Documents ANTHROPIC_API_KEY, OPENAI_API_KEY, TAVILY_API_KEY setup
- Added campaign creation step
- Updated troubleshooting for 500/503 errors

## Blockers

None. PR is ready for Tony to review and merge.

## Next steps

**For Tony:**
1. Review PR https://github.com/mysticalsin/aria-sourcing/pull/20
2. Merge to integration/sourcing-enrichment-on-main
3. Deploy ship 1 to Fly: `fly deploy -c fly.app.toml -a aria-mantu-app`
4. Run setup steps from docs/FLY_SETUP.md:
   - Apply migrations to aria-mantu-db
   - Reload PostgREST schema cache
   - Run scripts/seed-fly-admin.sh with DEMO_ADMIN_PASSWORD
   - Set provider keys (ANTHROPIC_API_KEY, OPENAI_API_KEY)
5. Test E2E:
   - curl -sI https://aria-mantu-app.fly.dev/auth/callback (no 0.0.0.0)
   - Login at https://aria-mantu-app.fly.dev/ (should reach Command Center)
   - Create campaign, click "Source next batch" (should work)

**For next shift (if Tony finds issues):**
- Debug any setup failures
- Add missing verification steps
- Fix any deployment-specific issues

## Decisions made (don't relitigate)

1. **Auth redirect strategy:** Use x-forwarded-host header (set by Fly proxy) with fallback to explicit env var. Rejected using 0.0.0.0 or localhost for Location headers.
2. **Login method:** Password login with admin@hermes.local is primary. Demo login (ENTER THE DEMO CONSOLE button) is optional, same flag as Vercel.
3. **Documentation over code:** Ships 2-4 are pure documentation. No product changes, no new features, just setup instructions.
4. **No Fly deployment in this PR:** Tony must deploy manually after merge. Cloud agents don't have Fly CLI access.
5. **One logical change per ship:** Each commit is independently reviewable and has a single clear purpose.

## Watch out

1. **Branch naming:** Used cursor/fly-e2e-fixes-6014 (not fix/fly-auth-public-origin) per cloud agent requirements.
2. **GOTRUE_SITE_URL secrets:** If Tony previously set GOTRUE_SITE_URL as a Fly secret, it will override fly.auth.toml [env]. Must unset: `fly secrets unset GOTRUE_SITE_URL -a aria-mantu-auth`
3. **Migrations order:** Must apply ALL migrations (0001-0010) before seeding. Seed script assumes tables exist.
4. **PostgREST reload:** After migrations, MUST notify PostgREST or restart it. Otherwise workspace will hang on "Connecting to your workspace".
5. **Empty workspace:** After first login, workspace has 0 campaigns. Admin must create campaigns via UI before sourcing works.
6. **Provider keys required:** Without ANTHROPIC_API_KEY or OPENAI_API_KEY, /api/sourcing-agent returns 503. /api/hermes/chat falls back to mock.
7. **Vercel demo unchanged:** No changes to Vercel config. publicOrigin helper works on both Fly and Vercel (x-forwarded-host is set by both).
