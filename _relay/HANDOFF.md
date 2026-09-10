---
project: MSourcing / ARIA
shift: 126
agent: cursor-cloud
updated: 2026-09-10T15:16Z
status: fly-sourcing-e2e-working
---

# Handoff — Shift 126

## Current state

- **Branch:** `cursor/fly-sourcing-e2e-ready-b91d` @ `47be2b8`
- **Fly web:** https://aria-mantu-app.fly.dev — healthy; build `47be2b8…`
- Demo login: `Twalteur@amaris.com` (password via Fly secrets only)
- Live sourcing **works** for Amaris campaigns (deterministic + Tavily LinkedIn SERP): Calypso Application Support and Senior Calypso BA each returned 5 candidates @ 80%+
- `/api/ready` still `not_ready` on `agentFrameworks:false` (no DeerFlow/Flowise on this tenant; `/api/health` is the routing check)

## Done this shift

1. Diagnosed `SOURCING_AGENT_UNAVAILABLE` / “Campaign authority is unavailable” as workspace projection `invalid_state` (strict jobAnalysis + unlabeled githubQueries)
2. Fixed projection to strip extras / normalize githubQueries
3. Fixed Calypso title match + scoring so SERP leads clear the 80% floor
4. Deployed tip to `aria-mantu-app` and set `ARIA_RELEASE_SHA=47be2b8…`
5. Verified authenticated `POST /api/sourcing-agent` → 200 with candidates

## Blockers

1. LinkedIn Message send still needs operator Take control login/2FA on computers
2. Apify LinkedIn profile token not set — SERP path works; richer profile search would need vault Apify key

## Next steps

1. Merge `cursor/fly-sourcing-e2e-ready-b91d` (includes prior Twauteur demo-login tip)
2. Optional: store Apify key in workspace vault for `linkedin_profiles` provider
3. Operator LinkedIn login on `comp_java_01` when ready to send

## Decisions made (don't relitigate)

- Showcase Fly keeps demo-login ON for `Twalteur@amaris.com`
- Do not commit passwords / tokens
- `/api/ready` agentFrameworks failure is expected without Flowise/Deerflow; do not gate Fly http checks on it
- Live sourcing for LinkedIn-first roles uses deterministic multi-provider (Tavily + GitHub); Kimi is not a sourcing tool provider

## Watch out

- Do not bake `DEMO_ADMIN_PASSWORD` into the Docker image
- Keep `ARIA_RELEASE_SHA` in sync with the deployed git tip after each deploy
- Strict projection regressions will surface again as “sourcing agent is unavailable” for real workspace_state extras
