---
project: MSourcing / ARIA
shift: 127
agent: cursor-cloud
updated: 2026-09-10T16:20Z
status: fly-windows-desktop-need-live
---

# Handoff — Shift 127

## Current state

- **Branch:** `cursor/fly-sourcing-e2e-ready-b91d` @ `0eba792`
- **Fly web:** https://aria-mantu-app.fly.dev — build `0eba792…`
- **Active need on Amaris workspace:** `camp_mor1jp00097605_enterprise-windows-desktop-engineer`
  - Title: Enterprise Windows Desktop Engineer (MOR1JP00097605)
  - Client: Morgan Stanley · Employer: AMACAN · Montreal hybrid
  - Skills: Windows, PowerShell, Microsoft Intune, Cloud Migration, AD, Group Policy
- Verified: demo-login `Twalteur@amaris.com` → sourcing agent → **5 candidates** (Desktop/Intune/Endpoint, scores 83–89)

## Done this shift

1. Replaced Calypso as the working need with the AMACAN Windows Desktop Engineer brief
2. Seeded campaign into live `workspace_state` (prepended as first campaign)
3. Added Windows Desktop / Intune / Endpoint title matching; redeployed Fly
4. Seed helpers: `scripts/seed-windows-desktop-need.mjs`

## Blockers

1. LinkedIn Message send still needs operator Take control login/2FA
2. `/api/ready` still `agentFrameworks:false` (expected)

## Next steps

1. Open/refresh PR for `cursor/fly-sourcing-e2e-ready-b91d`
2. Operator: refresh console after login to pick up seeded campaign; run sourcing on Enterprise Windows Desktop Engineer
3. Optional Apify vault key for richer LinkedIn profile search

## Decisions made (don't relitigate)

- Showcase need for E2E is MOR1JP00097605 Enterprise Windows Desktop Engineer
- Do not commit passwords / tokens

## Watch out

- Workspace seed is DB-side; a client that overwrites `workspace_state` from an old tab can clobber the campaign — refresh after login
- Keep `ARIA_RELEASE_SHA` aligned with deployed tip
