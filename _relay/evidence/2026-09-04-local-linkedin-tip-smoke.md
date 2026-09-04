# Local tip smoke — LinkedIn fleet routes exist

**When:** 2026-09-04T14:01Z  
**SHA:** `20110a1` / later `9327970`  
**Server:** `npx next dev -p 3456` with `NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true`

| Route | Status | Notes |
| --- | --- | --- |
| `GET /api/health` | 200 | healthy |
| `GET /api/linkedin/connections` | **401** | route present (auth required) |
| `GET /api/fleet/computers` | **401** | route present |
| `GET /api/knowledge/campaign` | **401** | route present |
| `GET /auth/linkedin` | **503** | route present; needs OIDC vault/client id |

Contrast live Fly: same LinkedIn/fleet/knowledge paths still **404**.
