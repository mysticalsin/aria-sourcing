---
project: MSourcing / ARIA
shift: 318
agent: cursor-cloud
updated: 2026-10-03T18:20Z
status: seats-churn-ported-to-150-awaiting-owner-approve
---

# Handoff — Shift 318

## Current state

- **Deploy-land tip:** `cursor/fly-deploy-land-n-agent-b91d` — seatsRef churn fix ported onto #150 (pollGeneration + seatsRef)
- **#150:** squash auto-merge on; owner approve still required (REVIEW_REQUIRED)
- **#148 tip:** `41c7780` still lacks seatsRef — port next if still open
- **Fly:** still `21a42e7…` / `0084` / `hermesRuntime:true` — goal open until tip SHA + 0087 + LI desks healthy

## Done this shift

1. Aborted stray cherry-pick on pollgen branch (conflict only in `_relay/codex-findings.md`)
2. Ported seatsRef / campaignId-only remount onto deploy-land Agents panel + soft-nav contract (15/15)

## Blockers

1. Owner approve #150 → squash → dispatch + proof + LI healthy

## Next steps

1. Port seatsRef onto #148 tip if still open
2. Owner approve #150 + dispatch + `bash scripts/fly-n-agent-proof.sh` + LI Take→login→Release
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
