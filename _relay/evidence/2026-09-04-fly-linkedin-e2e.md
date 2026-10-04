# Fly LinkedIn E2E receipt (shift 100)

**Target:** https://aria-mantu-app.fly.dev  
**When:** 2026-09-04T13:59Z UTC  
**Branch tip:** `20110a1d88b895ad33da8f8429f568eb94beeeed` (PR #64)  
**Vercel touched:** no

## Live probes

| Check | Result |
| --- | --- |
| `GET /api/health` | 200 healthy |
| `GET /api/ready` | 200 ready · build `5728ad41…` · migration `0079_autopilot_enqueue_approval_hash_bind.sql` |
| `GET /auth/linkedin` | **401** Not authenticated (route present) |
| `GET /api/linkedin/connections` | **404** (tip not deployed) |
| `GET /api/fleet/computers` | **404** |
| `GET /api/knowledge/campaign` | **404** |
| Demo login | disabled (expected) |

## Tip proof (this branch)

- Routes on disk: `src/app/api/linkedin/connections`, `fleet/computers`, `knowledge/campaign`, `auth/linkedin`
- Tests: linkedin-credentials 15, channel-contract 17, connections 47, computer-supervisor 8; manifest contract 8/8
- Hooks fix: connections panel always calls state hook with `{ enabled: !ctx }`

## Blocked for live “working”

1. `FLY_API_TOKEN` (or protected workflow dispatch) — **requested** via Cloud Agent setup actions
2. Migration lineage: live **0079** vs branch **0063** — reconcile before deploy
3. Admin session + Aria vault keys for OIDC / Vendor / Supervisor after deploy

Until (1)–(2), LinkedIn Automatic cannot be claimed live on Fly.
