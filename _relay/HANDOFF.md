---
project: MSourcing / ARIA
shift: 322
agent: cursor-cloud
updated: 2026-10-03T18:45Z
status: fleet-li-badge-seats-churn-fixed-awaiting-owner-approve
---

# Handoff — Shift 322

## Current state

- **#150 tip:** seatsRef/pollGeneration on Agents, go-live, setup, Fleet, LinkedIn connections; campaign Agents badge stamps campaignId (soft-nav 20/20)
- **#148:** port this tip next
- **#150:** squash auto-merge on; owner approve still required
- **Fly:** `21a42e7…` / `0084` — goal open until tip SHA + 0087 + LI desks healthy

## Done this shift

1. Fixed Fleet + LinkedIn connections seats-churn wipe (seatsRef + pollGeneration)
2. Fixed campaign Agents badge soft-nav foreign durable count (authority stamp)

## Blockers

1. Owner approve #150 → squash → dispatch + proof + LI healthy

## Next steps

1. Port same fix onto #148 tip
2. Owner approve + dispatch + `bash scripts/fly-n-agent-proof.sh` + LI Take→login→Release
3. **do not UpdateGoal complete** until tip SHA + 0087 + LI desks healthy

## Decisions made (don't relitigate)

- Soft-nav / seats churn must not remount or clear durable across Agents, go-live, setup, Fleet, LI connections, campaign badge
- Never invent sessionHealthy=true
- Ignore Vercel-only CI when Quality/Release pass
- N-agent deploy does **not** require `agentFrameworks:true`

## Watch out

- No agent review/approve / FLY_API_TOKEN / request-reviewers
