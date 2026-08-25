# Fly golive — real tenant at aria-mantu-app.fly.dev

**Production URL:** https://aria-mantu-app.fly.dev/login?redirect=%2F

This is the real Mantu tenant. Demo login is intentionally disabled
(`NEXT_PUBLIC_ENABLE_DEMO_LOGIN=false` in `fly.app.toml`). Password auth goes
through GoTrue on `https://aria-mantu-kong.fly.dev`.

## Current gap (as of 2026-08-25)

| Check | Live Fly | Target (feature branch) |
|---|---|---|
| Login page | 200 | 200 |
| Demo login | Disabled (404) | Stay disabled |
| App build | `3ff4852…` | `8e42dc2` or newer |
| DB migration | `0046_swarm_orchestration_authority.sql` | `0059_linkedin_heyreach_parity.sql` |
| `/api/linkedin/*` | 404 (routes not shipped) | 401 without session |
| GoTrue redirects | `aria-mantu-app.fly.dev` | same |

LinkedIn HeyReach parity (assisted-manual connect, simulate, webhook, classify)
requires **migrations 0047–0059** and a **new app image** on Fly.

## Owner deploy (sanctioned)

Use `.github/workflows/deploy-aria-mantu.yml` only:

1. Merge LinkedIn work to `deploy/fly-github-actions` (or fast-forward that branch).
2. Ensure CI + CodeQL are green on the exact release SHA (Actions budget must allow runs).
3. `workflow_dispatch` with:
   - `release_sha` — 40-char SHA on the protected branch
   - `recovery_receipt_sha256` — digest of the reviewed volume recovery receipt
4. Optional after deploy: `fly secrets set LINKEDIN_INBOUND_WEBHOOK_SECRET=… -a aria-mantu-app`

Do **not** enable demo login on Fly.

## Preflight script

```bash
bash scripts/fly-golive-linkedin.sh <release_sha>
```

Read-only probes + prints dispatch instructions. No Fly mutation.

## Post-deploy proof

```bash
curl -fsS https://aria-mantu-app.fly.dev/api/health
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq .build,.migration
# LinkedIn routes exist (401 without cookie — not 404):
curl -sS -o /dev/null -w '%{http_code}\n' https://aria-mantu-app.fly.dev/api/linkedin/connections
ADMIN_EMAIL=… ADMIN_PASSWORD=… ANON_KEY=… bash e2e-workflow-test.sh
```

## Vercel demo is not production

`https://aria-sourcing-demo.vercel.app` remains an open demo for sales. The Fly
URL above is where real auth, Supabase, and durable LinkedIn events belong.
