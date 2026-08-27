---
project: MSourcing / ARIA
shift: 106
agent: cursor-cloud
updated: 2026-08-27 UTC
status: fly-only-locked-awaiting-deploy-confirm
---

# Handoff — Shift 106

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#30**
- **Decision (this shift):** Mantu enterprise production **Fly only** (`aria-mantu-app` / bootstrap). **Never Vercel.**
- **vercel.json** `ignoreCommand` skips builds on every branch except `vercel-demo`
- **Deploy scripts** refuse non-Fly targets; confirm token format fixed to `aria-production-release-v1:<op>:<sha>:<apps>`
- **Local:** audit matrix **19/19**
- **CI:** still org-wide empty runners
- **Fly live:** still migration **0060**; deploy blocked on `ARIA_PROD_DEPLOY_CONFIRM`

## Done this shift

- Fly-only lock: vercel ignore + golive/deploy script guards + E2E refuses vercel.app
- Fixed wrong confirm-token order in golive scripts

## Blockers

1. Owner: provide `ARIA_PROD_DEPLOY_CONFIRM=aria-production-release-v1:fly-deploy-now:<tip-sha>:aria-mantu-bootstrap,aria-mantu-app`
2. Then agent runs **only** `bash scripts/fly-deploy-now.sh` (no Vercel)
3. Actions runners still down

## Next steps

1. Receive deploy confirm → Fly-only push (bootstrap migrations through 0063 + app)
2. Set M365/webhook secrets on Fly
3. `e2e-workflow-test.sh` against aria-mantu-app.fly.dev

## Decisions made (don't relitigate)

- Enterprise Mantu production host = Fly only; Vercel = demo (`vercel-demo`) only
- LinkedIn send assisted-manual (409)
- No production mutate without confirm token
