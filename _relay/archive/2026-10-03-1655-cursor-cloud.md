---
project: MSourcing / ARIA
shift: 311
agent: cursor-cloud
updated: 2026-10-03T16:50Z
status: tip-n-agent-closed-fly-blocks-goal
---

# Handoff — Shift 311

## Current state

- **Deploy-land:** `cursor/fly-deploy-land-n-agent-b91d` — PR https://github.com/mysticalsin/aria-sourcing/pull/150
- **#150:** `MERGEABLE`, squash auto-merge on, **`REVIEW_REQUIRED` only**
- **Tip residual:** **NONE**
- **Deploy acceptance:** tip+Hermes ready JSON (`require_app_ready_json`) + adapter-absent degraded framework heartbeat accepted; `worker_exception` still fails
- **Proof:** `scripts/fly-n-agent-proof.sh` — tip SHA + migration 0087 + Hermes plane
- **Fly:** still `21a42e7…` / `0084` / `hermesRuntime:true` / `/api/ready` 503
- **Contracts:** deploy 140/140, infra-release 135/135, apollo-cleanup 6/6
- **Goal:** **open** until Fly tip SHA + LI desks healthy

## Done this shift

1. Softened framework heartbeat release evidence for Hermes-only tenant (degraded adapter/inventory OK)
2. Prior: ready JSON 503 with only frameworks false passes deploy

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
- N-agent deploy does **not** require `agentFrameworks:true` or healthy DeerFlow/Flowise heartbeats
- Heartbeat `worker_exception` still fails deploy

## Watch out

- No agent review/approve / FLY_API_TOKEN
- Docs pushes cancel CI — re-verify green before dispatch on deploy HEAD
