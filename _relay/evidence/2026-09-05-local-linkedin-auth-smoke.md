# Local authenticated LinkedIn tip smoke

**When:** 2026-09-05T07:10Z  
**SHA:** `7c961d9106bbdf168bb8329befbb1fa2067683bf`  
**Server:** `next dev :3456` with `NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true` + `DEMO_SESSION_SECRET`

## Unit / contract (this tip)

| Suite | Result |
| --- | --- |
| linkedin-credentials | 15/15 |
| linkedin-channel-contract | 17/17 |
| linkedin-connections | 47/47 |
| computer-supervisor | 8/8 |
| contact-lease | 10/10 |
| knowledge-plane | 6/6 |
| sourcing-automatic-deliver | 7/7 |
| linkedin-oauth | 8/8 |
| linkedin-policy | 31/31 |
| `tsc --noEmit` | clean |

## Authenticated HTTP smoke

| Step | Result |
| --- | --- |
| `POST /api/auth/demo-login` admin/admin | `{"ok":true}` |
| `GET /api/linkedin/connections` | **200** demo readiness (`oauthConfigured:false`, `assistedManual:true`, seats `[]`) |
| `POST /api/linkedin/connections` `ensure_oauth` | **200** dry-run demo (Supabase required for durable route) |
| `GET /api/fleet/computers` | **200** `{"computers":[]}` |
| `GET /api/knowledge/campaign` | **400** `campaignId required` (route present) |
| `GET /auth/linkedin` | **503** OIDC not configured (fail-closed; vault/env expected) |

## Live Fly contrast

`https://aria-mantu-app.fly.dev` still **404** on LinkedIn fleet/knowledge APIs — tip not deployed. Waiting on `FLY_API_TOKEN`.
