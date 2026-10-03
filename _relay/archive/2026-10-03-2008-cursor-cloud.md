---
project: MSourcing / ARIA
shift: 339
agent: cursor-cloud
updated: 2026-10-03T20:01Z
status: setup-guide-assert-fixed-awaiting-ci-and-owner-approve
---

# Handoff — Shift 339

## Current state

- **#150 tip:** `6f2fef6` — store-contracts 131 + setup-guide take-control assert accepts `campaignId` soft-nav
- **#148 tip:** `991141d` — same cherry-picks
- Local: linkedin-connections 58/0, store-contracts 11/11, floor 33, soft-nav 25, hermes-sync 23, supervisor 137
- Tip FE↔BE residual hunt: **NONE**
- **#150:** squash auto-merge on; `REVIEW_REQUIRED` (agent cannot approve)
- **Fly:** `21a42e7…` / `0084` / hermesRuntime true — proof fails build==tip + migration≥0087

## Done this shift

1. Fixed store-contracts HermesActions 130→131
2. Fixed linkedin-connections setup-guide assert (`campaign.id` → `campaignId`)
3. Reconfirmed tip FE↔BE residuals NONE; Fly still stale

## Blockers

1. Owner approve #150 → squash → dispatch + proof + LI Take→login→Release
2. Await Quality + Release green on `6f2fef6` / `991141d`

## Next steps

1. Confirm Quality + Release green on both tips
2. Owner approve #150 + wait CI on deploy HEAD + workflow_dispatch Fly Deploy Aria Mantu
3. `bash scripts/fly-n-agent-proof.sh` + LI Take→login→Release
4. **do not UpdateGoal complete** until tip SHA + 0087 + LI desks healthy

## Decisions made (don't relitigate)

- Probe candidates need remoteUrl; rotate by sessionProbedAt
- Durable Map conflicts adopt; poll Hermes local-only; detach skips durableById
- Never invent sessionHealthy=true
- Ignore Vercel-only CI when Quality/Release pass
- N-agent deploy does **not** require `agentFrameworks:true`
- Setup-guide take-control fetch keys on `campaignId` (soft-nav), not `campaign.id` inline

## Watch out

- No agent review/approve / FLY_API_TOKEN / request-reviewers
