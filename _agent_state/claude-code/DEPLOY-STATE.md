# Deploy state — 2026-07-10 (resume here after Tony runs `flyctl auth login`)

READY TO DEPLOY (Fly.io, Owner-chosen). All prep done; ONLY blocker = Fly auth.

## Post-auth sequence (I run this once `flyctl auth whoami` succeeds)
1. Source secrets: production-readiness/.fly-secrets.env (gitignored) — FLY_JWT_SECRET, FLY_SUPABASE_ANON_KEY, FLY_SUPABASE_SERVICE_KEY, FLY_DATA_ENCRYPTION_KEY, FLY_CRON_SECRET, FLY_PG_PASSWORD.
2. Supabase backend on Fly: Postgres app + persistent volume; apply supabase/migrations 0001..0018 (0016 absent); GoTrue+PostgREST+Kong (from docker-compose.yml services) with the FRESH jwt secret (NOT the public demo keys in the compose file). Regenerate anon/service = the FLY_ keys.
3. App on Fly: build from `Dockerfile.prod` (multi-stage prod build; the root `Dockerfile` is DEV-ONLY — never ship it. See plan `~/.claude/plans/msourcing-fly-and-vercel-prod.md`); env = SUPABASE_URL(kong internal), NEXT_PUBLIC_SUPABASE_URL(public), NEXT_PUBLIC_SUPABASE_ANON_KEY=FLY anon, SUPABASE_SERVICE_ROLE_KEY=FLY service, DATA_ENCRYPTION_KEY, CRON_SECRET, OUTREACH_UNSUBSCRIBE_BASE_URL=https://<fly-app>.fly.dev, TAVILY_API_KEY (from .env.local), NODE_ENV=production, NO NEXT_PUBLIC_ENABLE_DEMO_LOGIN.
4. Create Tony's admin user (Supabase auth) OR rely on migration 0018 first-admin on first login.
5. Acceptance: on the public Fly URL, paste a real need → confirm real candidates (GitHub + LinkedIn via Tavily), provenance=live.

## Known constraints
- App bundles a 7-service Supabase stack (docker-compose.yml) — this is real infra, iterate live.
- obscura sidecar (browser tool) is OPTIONAL — skip for a sourcing deploy to cut the Rust build.
- Vercel alone CANNOT host this (serverless, no bundled Postgres).
