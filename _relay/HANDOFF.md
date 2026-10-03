---
project: MSourcing / ARIA
shift: 328
agent: cursor-cloud
updated: 2026-10-03T19:15Z
status: poll-hermes-local-only-fly-blocks-goal
---

# Handoff — Shift 328

## Current state

- **#148 tip:** poll paths apply fleetHermesComputerPatches locally via `applyFleetHermesComputerPatches` — never PATCH computerId (races reclaim/ensure)
- **#150:** port next; owner approve still required
- **Fly:** `21a42e7…` / `0084` — goal open until tip SHA + 0087 + LI desks healthy

## Done this shift

1. Added local-only `applyFleetHermesComputerPatches` / `applyHermesComputerPatchesToSeats`
2. Floor/Fleet/Agents/LinkedIn polls no longer `updateSeat({computerId})` on GET
3. soft-nav 23/23; floor-fleet-wire 31/31; fleet-hermes-sync 23/23

## Blockers

1. Owner approve #150 → squash → dispatch + proof + LI healthy

## Next steps

1. Port onto #150
2. Owner approve + dispatch + `bash scripts/fly-n-agent-proof.sh` + LI Take→login→Release
3. **do not UpdateGoal complete** until tip SHA + 0087 + LI desks healthy

## Decisions made (don't relitigate)

- Poll Hermes computerId align is local-only; durable writes only via ensure/reclaim/Deploy
- Soft-nav / seats churn seatsRef stack + adoptDurable on stale Map
- Never invent sessionHealthy=true
- Ignore Vercel-only CI when Quality/Release pass
- N-agent deploy does **not** require `agentFrameworks:true`

## Watch out

- No agent review/approve / FLY_API_TOKEN / request-reviewers
