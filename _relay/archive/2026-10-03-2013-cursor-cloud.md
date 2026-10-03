---
project: MSourcing / ARIA
shift: 340
agent: cursor-cloud
updated: 2026-10-03T20:08Z
status: go-live-all-N-fixed-awaiting-ci-and-owner-approve
---

# Handoff — Shift 340

## Current state

- **#150 tip:** `5197af5` — go-live + fleet-health-strip require all attached N desks (no 1/N green)
- **#148 tip:** `e6f5fe5` — same
- Prior on tip: store-contracts 131, setup-guide campaignId soft-nav assert
- Local: campaign-go-live 32, floor-fleet-wire 34, linkedin-connections 58, store-contracts 11
- Tip FE↔BE wiring: NONE; go-live N-subset theater: **fixed**
- **#150:** squash auto-merge on; `REVIEW_REQUIRED`
- **Fly:** `21a42e7…` / `0084` — proof fails tip SHA + 0087

## Done this shift

1. Fixed go-live attach/live/session denom = attached (not withComputer subset)
2. Fleet health strip success only when liveReady === seats
3. Tests for 1/N partial bind + strip tone drift

## Blockers

1. Owner approve #150 → squash → dispatch + proof + LI healthy
2. Await Quality + Release on `5197af5` / `e6f5fe5`

## Next steps

1. Confirm Quality + Release green
2. Owner approve #150 + Fly Deploy Aria Mantu dispatch
3. `bash scripts/fly-n-agent-proof.sh` + LI Take→login→Release
4. **do not UpdateGoal complete** until tip SHA + 0087 + LI desks healthy

## Decisions made (don't relitigate)

- Probe candidates need remoteUrl; rotate by sessionProbedAt
- Durable Map conflicts adopt; poll Hermes local-only; detach skips durableById
- Never invent sessionHealthy=true
- Ignore Vercel-only CI when Quality/Release pass
- N-agent deploy does **not** require `agentFrameworks:true`
- Go-live / health-strip: all attached N desks, never 1/N subset green

## Watch out

- No agent review/approve / FLY_API_TOKEN / request-reviewers
