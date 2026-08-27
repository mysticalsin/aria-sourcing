---
project: MSourcing / ARIA
shift: 107
agent: cursor-cloud
updated: 2026-08-27 UTC
status: production-hardening-awaiting-fly-deploy
---

# Handoff — Shift 107

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#30**
- **Production host:** Fly only (`aria-mantu-app`); Vercel skipped except `vercel-demo`
- **Local gate:** `tsc` + `npm test` green; audit matrix **22/22**
- **CI:** org-wide Actions runner outage (not code)
- **Fly live:** migration **0060**; needs deploy through **0063** + secrets

## Done this shift (code hardening from audit)

- Quality pipeline enforced at approve/send + rules gate (`outreachQualityGate`)
- Autonomous sourcing cron resolves workspace Apify/Tavily keys
- Draft cron persists quality + Mantu HTML; worker fails if route unconfigured or quality blocked
- Calendar route returns `reconciliation-required` unless reconcile succeeds
- Teams join URLs stored in `teamsLink`; UI no longer mislabels Graph links as Cal.com
- M365 calendar readiness requires granted calendar scope (not OAuth env alone)

## Blockers (owner)

1. `ARIA_PROD_DEPLOY_CONFIRM` for Fly-only deploy (`fly-deploy-now.sh`)
2. Restore GitHub Actions runners
3. M365/Entra/webhook secrets on Fly; deployed E2E

## Still open (larger scope)

- First-party Microsoft Graph webhook subscription (no inbox polling)
- Replace mock-ai stand-ins in autonomous parse/draft with configured server models
- LangGraph as production coordinator vs worker authority documentation/wiring

## Decisions made (don't relitigate)

- Fly-only enterprise production; LinkedIn send assisted-manual (409)
- No prod mutate without confirm token
