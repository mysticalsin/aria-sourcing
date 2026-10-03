---
project: MSourcing / ARIA
shift: 323
agent: cursor-cloud
updated: 2026-10-03T18:46Z
status: fleet-li-badge-on-148-and-150-fly-blocks-goal
---

# Handoff — Shift 323

## Current state

- **#148 + #150:** seatsRef/pollGeneration on Agents, go-live, setup, Fleet, LinkedIn connections; campaign Agents badge stamps campaignId (soft-nav 20/20)
- **#150:** squash auto-merge on; owner approve still required
- **Fly:** `21a42e7…` / `0084` — goal open until tip SHA + 0087 + LI desks healthy

## Done this shift

1. Ported Fleet/LI/campaign-badge seats-churn fix onto #148
2. Soft-nav contract 20/20

## Blockers

1. Owner approve #150 → squash → dispatch + proof + LI healthy

## Next steps

1. Owner approve #150 + wait CI on deploy HEAD + workflow_dispatch Fly Deploy Aria Mantu
2. `bash scripts/fly-n-agent-proof.sh` + LI Take→login→Release
3. **do not UpdateGoal complete** until tip SHA + 0087 + LI desks healthy

## Decisions made (don't relitigate)

- Soft-nav / seats churn must not remount or clear durable across Agents, go-live, setup, Fleet, LI connections, campaign badge
- Never invent sessionHealthy=true
- Ignore Vercel-only CI when Quality/Release pass
- N-agent deploy does **not** require `agentFrameworks:true`

## Watch out

- No agent review/approve / FLY_API_TOKEN / request-reviewers
