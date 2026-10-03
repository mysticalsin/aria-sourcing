---
project: MSourcing / ARIA
shift: 319
agent: cursor-cloud
updated: 2026-10-03T18:22Z
status: seats-churn-on-148-and-150-fly-blocks-goal
---

# Handoff — Shift 319

## Current state

- **#148 tip:** `cursor/linkedin-human-claude-chrome-b91d` — seatsRef churn fix ported (parity with #150 / `4ca658e`)
- **#150 tip:** `cursor/fly-deploy-land-n-agent-b91d` @ `a088f65` — seatsRef + soft-nav; squash auto-merge on; owner approve still required
- **Fly:** still stale (`21a42e7…` / `0084`) — goal open until tip SHA + 0087 + LI desks healthy

## Done this shift

1. Ported seatsRef onto #150 (`a088f65`) and #148 Agents panel + soft-nav 15/15
2. Aborted stray cherry-pick conflict on pollgen branch

## Blockers

1. Owner approve #150 → squash → dispatch + proof + LI healthy

## Next steps

1. Owner approve #150 + wait CI on deploy HEAD + workflow_dispatch Fly Deploy Aria Mantu
2. `bash scripts/fly-n-agent-proof.sh` + LI Take→login→Release
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
