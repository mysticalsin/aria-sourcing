---
project: MSourcing / ARIA
shift: 310
agent: cursor-cloud
updated: 2026-10-03T16:45Z
status: tip-n-agent-closed-fly-blocks-goal
---

# Handoff — Shift 310

## Current state

- **Deploy-land:** `cursor/fly-deploy-land-n-agent-b91d` — PR https://github.com/mysticalsin/aria-sourcing/pull/150
- **#150:** `MERGEABLE`, squash auto-merge on, **`REVIEW_REQUIRED` only**
- **Tip residual:** **NONE**
- **Deploy acceptance:** `deploy-fly.sh` now uses `require_app_ready_json` (tip SHA + Hermes data plane); HTTP 503 with only `agentFrameworks:false` **passes**
- **Proof:** `scripts/fly-n-agent-proof.sh` same gate (no DeerFlow/Flowise requirement)
- **Fly:** still `21a42e7…` / `0084` / `hermesRuntime:true` / `/api/ready` 503
- **Contracts:** `infra-release-contract` 135/135, `deploy-contract` 138/138
- **Goal:** **open** until Fly tip SHA + LI desks healthy

## Done this shift

1. Fixed deploy acceptance so official Deploy Aria Mantu can succeed without DeerFlow/Flowise sidecars
2. Updated deploy-contract + infra-release-contract
3. Prior: proof script Hermes+0087 gate; residual NONE

## Blockers

1. Owner approve #150 → squash → CI on deploy HEAD → dispatch + proof + LI healthy

## Next steps

1. Owner approve #150 + dispatch + `bash scripts/fly-n-agent-proof.sh` + LI Take→login→Release
2. **do not UpdateGoal complete** until tip SHA + 0087 + LI desks healthy

## Decisions (don't relitigate)

- Tip N-agent class closed on tip; production incomplete until Fly tip + LI healthy
- Never invent sessionHealthy=true
- Ignore Vercel-only CI when Quality/Release pass
- campaignId on Take/resolve/boot only when seat already attached
- N-agent goal / deploy acceptance do **not** require `agentFrameworks:true` on this tenant
- AGENT_FRAMEWORKS_REQUIRED stays true for honest component bit; deploy gates Hermes+tip JSON

## Watch out

- No agent review/approve / FLY_API_TOKEN
- Framework heartbeat process evidence still required by `verify_apollo_cleanup_release` after ready JSON
- Docs pushes cancel CI — re-verify green before dispatch on deploy HEAD
