# Fly LinkedIn tip live — 2026-09-05

**App:** https://aria-mantu-app.fly.dev  
**Deployed image tip:** `911634d0881e36619cb40831ccef93cc32c2c837` (machine version 223)  
**Migration applied:** `0080_contact_lease_and_browser_computer.sql` (live ledger count 79)

## Live HTTP results

| Route | Before | After |
| --- | --- | --- |
| `GET /api/health` | 200 | **200** healthy |
| `GET /api/linkedin/connections` | **404** | **401** Not authenticated |
| `GET /auth/linkedin` | 401 | **401** Not authenticated |
| `GET /api/fleet/computers` | 404 | **401** No workspace |
| `GET /api/knowledge/campaign` | 404 | **400** campaignId required |
| `GET /api/ready` | 200 | **503** `agentFrameworks:false` (Flowise/Deerflow not on this tenant; `/api/health` remains the Fly routing check) |

## What shipped

1. Fly token authenticated; app-only deploy of LinkedIn Automatic + vault tip
2. Contact lease schema applied as **0080** (live already owned a different `0063`)
3. Staged readiness secrets updated to migration 0080 / ledger count 79
4. Client/server bundle split so production Next build succeeds

## Still needed for full E2E send

- Admin login (demo login off on Fly)
- Aria vault keys: LinkedIn OIDC, Vendor API, and/or Computer Supervisor
- OIDC connect → Automatic Vendor or Browser Computer send

## Note

`/api/ready` staying 503 on `agentFrameworks` is intentional for this tenant (readiness tests forbid env opt-out). Routing health is `/api/health`.
