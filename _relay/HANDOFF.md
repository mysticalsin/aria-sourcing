---
project: MSourcing / ARIA
shift: 326
agent: cursor-cloud
updated: 2026-10-03T19:05Z
status: floor-adopt-durable-fixed-awaiting-owner-approve
---

# Handoff — Shift 326

## Current state

- **#150 tip:** Floor/health-strip cancel-before-write + seats churn deps; adoptDurableComputerBinding on stale Map ownership-mismatch (do not null rightful FK)
- **#148:** port next
- **#150:** squash auto-merge on; owner approve still required
- **Fly:** `21a42e7…` / `0084` — goal open until tip SHA + 0087 + LI desks healthy

## Done this shift

1. Floor + fleet-health-strip: cancelled gate before Hermes write; deps `[actions]` only
2. Supervisor `adoptDurableComputerBinding` + GET uses it when mismatch and no other DB seat claims computer_id
3. computer-supervisor 133/133; floor-fleet-wire 30/30; soft-nav 20/20

## Blockers

1. Owner approve #150 → squash → dispatch + proof + LI healthy

## Next steps

1. Port onto #148
2. Owner approve + dispatch + `bash scripts/fly-n-agent-proof.sh` + LI Take→login→Release
3. **do not UpdateGoal complete** until tip SHA + 0087 + LI desks healthy

## Decisions made (don't relitigate)

- Soft-nav / seats churn seatsRef stack (Agents/go-live/setup/Fleet/LI/badge/Floor/health-strip)
- Ownership-mismatch: clear only when another DB seat claims computer_id; else adopt durable Map rebind
- Never invent sessionHealthy=true
- Ignore Vercel-only CI when Quality/Release pass
- N-agent deploy does **not** require `agentFrameworks:true`

## Watch out

- No agent review/approve / FLY_API_TOKEN / request-reviewers
