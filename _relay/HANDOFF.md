---
project: MSourcing / ARIA
shift: 334
agent: cursor-cloud
updated: 2026-10-03T19:30Z
status: probe-rotate-n-desks-awaiting-owner-approve
---

# Handoff — Shift 334

## Current state

- **#150 tip:** refreshSessionHealthForList rotates by sessionProbedAt (never-probed/oldest first) so N desks are not starved
- **#148:** port next
- **#150:** squash auto-merge on; owner approve still required
- **Fly:** `21a42e7…` / `0084` — goal open until tip SHA + 0087 + LI desks healthy

## Done this shift

1. Fixed probe budget starvation — sort candidates by sessionProbedAt ascending before slice
2. computer-supervisor 136/136; floor-fleet-wire 32/32

## Blockers

1. Owner approve #150 → squash → dispatch + proof + LI healthy

## Next steps

1. Port onto #148
2. Owner approve + dispatch + `bash scripts/fly-n-agent-proof.sh` + LI Take→login→Release
3. **do not UpdateGoal complete** until tip SHA + 0087 + LI desks healthy

## Decisions made (don't relitigate)

- N-desk Floor health probes rotate (never-probed first); Map-order must not monopolize limit=5
- Durable Map conflicts adopt; poll Hermes local-only; detach skips durableById
- Never invent sessionHealthy=true
- Ignore Vercel-only CI when Quality/Release pass
- N-agent deploy does **not** require `agentFrameworks:true`

## Watch out

- No agent review/approve / FLY_API_TOKEN / request-reviewers
