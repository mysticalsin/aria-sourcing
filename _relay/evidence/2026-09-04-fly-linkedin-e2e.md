# Fly LinkedIn E2E receipt (no Vercel)

**Target:** https://aria-mantu-app.fly.dev  
**When:** 2026-09-04T04:23:36.418607Z  
**Vercel touched:** no

## Proven on live Fly

| Check | Result |
| --- | --- |
| `/api/health` | healthy |
| `/api/ready` | ready · build `5728ad41…` · migration `0079_…` |
| Login UI | email/password form renders |
| `/settings`, `/fleet` | 307 → login (auth required) |
| `/auth/linkedin` | **401 Not authenticated** (route exists; admin session required) |
| Demo login | disabled (404) — correct for production |

## Not on live tip yet (PR #61)

| Route | Live |
| --- | --- |
| `/api/linkedin/connections` | **404** |
| `/api/fleet/computers` | **404** |
| `/api/knowledge/campaign` | **404** |

Live tip does **not** include the automatic VM-fleet branch. Connection API + computers panel need a protected Fly deploy of that SHA.

## Unit/contract proof (this branch)

- linkedin-policy 31, linkedin-channel-contract 16, linkedin-connections 47
- contact-lease 10, computer-supervisor 8, sourcing-automatic-deliver 7

## Blocked for full authenticated E2E

1. **Admin credentials** — `ADMIN_EMAIL` + `ADMIN_PASSWORD` + Kong `ANON_KEY` (demo-login is off)
2. **Fly deploy** of `cursor/linkedin-auto-vm-fleet-b91d` / PR #61 via protected workflow
3. **Fly secrets** `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` (+ vendor or computer supervisor for automatic send)

Without (1)–(3), LinkedIn OIDC connect and automatic send cannot be exercised end-to-end on Fly.
