---
project: MSourcing / ARIA
shift: 124
agent: cursor-cloud
updated: 2026-09-10T00:52Z
status: fly-demo-password-blocked-no-token
---

# Handoff — Shift 124

## Current state

- **Branch:** `cursor/aria-e2e-antibot-ux-b91d`
- Local demo password wired to `DEMO_ADMIN_PASSWORD` / `NEXT_PUBLIC_DEMO_ADMIN_PASSWORD` in `.env.local` (gitignored) = Jet5575!!
- Verified local `POST /api/auth/demo-login` accepts Jet5575!! and rejects `admin`
- **https://aria-mantu-app.fly.dev** returns `Disabled in production.` for `/api/auth/demo-login` (expected: `NEXT_PUBLIC_ENABLE_DEMO_LOGIN=false` in `fly.app.toml`)
- **No `FLY_API_TOKEN`** in this environment — cannot `fly secrets set` / redeploy

## Done this shift

1. Demo login route + login page use env password (no hard-coded `admin`/`admin`)
2. Recording scripts read `DEMO_ADMIN_PASSWORD`
3. Probed Fly: health 200; demo-login disabled for both Jet5575!! and admin

## Blockers

1. Need `FLY_API_TOKEN` (Cloud Agent secret) to mutate `aria-mantu-app`
2. Enabling demo login on Fly requires rebuild (`NEXT_PUBLIC_ENABLE_DEMO_LOGIN` is a build arg) — contradicts `fly.app.toml` real-tenant policy unless owner explicitly overrides

## Next steps (operator)

To make `admin` / `Jet5575!!` work on https://aria-mantu-app.fly.dev (demo path):

```bash
fly auth token   # or inject FLY_API_TOKEN into Cloud Agent secrets
# Runtime secret:
fly secrets set -a aria-mantu-app DEMO_ADMIN_PASSWORD='Jet5575!!' DEMO_SESSION_SECRET="$(openssl rand -hex 32)"
# Rebuild/redeploy with demo login ON (build arg) — owner decision only:
# change fly.app.toml NEXT_PUBLIC_ENABLE_DEMO_LOGIN = "true" then protected deploy
```

If they mean a real Supabase user password instead: need `SUPABASE_SERVICE_ROLE_KEY` + admin user id/email; demo-login path will stay disabled.

## Decisions made (don't relitigate)

- Production LinkedIn/OpenBot = Fly only
- Never mock send on prod
- Do not enable demo login on real tenant without explicit owner override

## Watch out

- Do not commit `.env.local` or real passwords
- Do not set `COMPUTER_SUPERVISOR_MOCK_SEND` on prod
