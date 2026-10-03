---
project: MSourcing / ARIA
shift: 320
agent: cursor-cloud
updated: 2026-10-03T18:35Z
status: sibling-seats-churn-fixed-fly-blocks-goal
---

# Handoff — Shift 320

## Current state

- **#148 tip:** seatsRef on Agents + go-live checklist + setup guide (soft-nav 17/17)
- **#150:** port sibling seats-churn fix next; owner approve still required
- **Fly:** `21a42e7…` / `0084` / `hermesRuntime:true` — goal open until tip SHA + 0087 + LI desks healthy

## Done this shift

1. Adversarial tip hunt after seatsRef Agents fix
2. Fixed go-live checklist + setup guide: clear durable only on campaignId; seats via refs

## Blockers

1. Owner approve #150 → squash → dispatch + proof + LI healthy

## Next steps

1. Port sibling seats-churn fix onto deploy-land / #150
2. Owner approve + dispatch + `bash scripts/fly-n-agent-proof.sh` + LI Take→login→Release
3. **do not UpdateGoal complete** until tip SHA + 0087 + LI desks healthy

## Decisions made (don't relitigate)

- Soft-nav late prior-campaign paint stays via pollGeneration; seats churn must not remount/clear
- Sibling go-live / setup-guide same seatsRef rule as Agents
- Never invent sessionHealthy=true
- Ignore Vercel-only CI when Quality/Release pass
- N-agent deploy does **not** require `agentFrameworks:true`

## Watch out

- No agent review/approve / FLY_API_TOKEN / request-reviewers
- Docs pushes cancel CI — re-verify green before dispatch on deploy HEAD
