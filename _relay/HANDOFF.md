---
project: MSourcing / ARIA
shift: 317
agent: cursor-cloud
updated: 2026-10-03T18:12Z
status: tip-pollgen-seats-churn-fixed-fly-blocks-goal
---

# Handoff — Shift 317

## Current state

- **Hunt/fix branch:** `cursor/n-agent-pollgen-seats-churn-6d88` — Agents seats-churn pollGeneration fix
- **Deploy-land tip:** `cursor/fly-deploy-land-n-agent-b91d` @ `a3e4862` (merge fix onto tip / #150)
- **#150:** squash auto-merge on; owner approve still required
- **Fly:** still `21a42e7…` / `0084` / `hermesRuntime:true` — goal open until tip SHA + 0087 + LI desks healthy

## Done this shift

1. Post–soft-nav tip residual hunt → seats-churn regression on pollGeneration
2. Fixed Agents panel: seatsRef + clear/gen bump only on `campaignId`; soft-nav suite 15/15

## Blockers

1. Owner approve #150 → squash → dispatch + proof + LI healthy (include seats-churn fix)

## Next steps

1. Land seats-churn fix onto deploy-land tip / #150
2. Owner approve + dispatch + `bash scripts/fly-n-agent-proof.sh` + LI Take→login→Release
3. **do not UpdateGoal complete** until tip SHA + 0087 + LI desks healthy

## Decisions made (don't relitigate)

- Soft-nav late prior-campaign paint stays via pollGeneration; seats churn must not remount/clear
- Never invent sessionHealthy=true
- Ignore Vercel-only CI when Quality/Release pass
- campaignId on Take/resolve/boot only when seat already attached
- Fleet Deploy omits campaignId for newly minted seats
- N-agent deploy does **not** require `agentFrameworks:true`

## Watch out

- No agent review/approve / FLY_API_TOKEN / request-reviewers
- Docs pushes cancel CI — re-verify green before dispatch on deploy HEAD
