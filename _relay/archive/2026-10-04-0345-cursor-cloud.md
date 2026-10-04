---
project: MSourcing / ARIA
shift: 349
agent: cursor-cloud
updated: 2026-10-04T03:40Z
status: tip-reclaim-take-preproof-awaiting-ci
---

# Handoff — Shift 349

## Current state

- **Branch tip:** pending commit on `cursor/fly-deploy-land-n-agent-b91d` (reclaim Take guard + pre-proof not-sent)
- Prior tip `10d5cfe`; #150 still `REVIEW_REQUIRED`
- Fly prod still `21a42e7` / migration `0084`

## Done this shift

1. `reclaimHealthyOrphan` + route refuse while human Holds (no orphan claim mid-login)
2. BC pre-Send OpenBot throws (`stale snapshot` / `ref not found` / 4xx) → `not-sent`

## Blockers

1. Owner Approve #150 → squash → Deploy Aria Mantu → fly-n-agent-proof → LI Take→login→Release
2. Never invent sessionHealthy; do not UpdateGoal complete until tip SHA + ≥0087/0089/0090 + LI healthy

## Next steps

1. Wait tip CI green
2. Reconfirm TIP_RESIDUALS NONE
3. Owner Approve #150; wait deploy HEAD CI; owner workflow_dispatch Deploy
4. `bash scripts/fly-n-agent-proof.sh` then manual LI desk health

## Decisions made (don't relitigate)

- Never invent sessionHealthy=true
- Open durable Take blocks cold restore green; navigate/session_probe/reclaim share human mutex
- Post-click no-proof stays unknown; pre-act/pre-proof soft fails → not-sent → deferred

## Watch out

- Fingerprint pin after claim function replace migrations
- No agent review/approve / FLY_API_TOKEN / workflow_dispatch
- click-xy/type-text/key/scroll stay allowed during Take (operator input)
