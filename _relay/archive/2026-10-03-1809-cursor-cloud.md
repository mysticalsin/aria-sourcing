---
project: MSourcing / ARIA
shift: 316
agent: cursor-cloud
updated: 2026-10-03T17:45Z
status: tip-n-agent-closed-fly-blocks-goal
---

# Handoff — Shift 316

## Current state

- **Deploy-land:** `cursor/fly-deploy-land-n-agent-b91d` @ `908f787` — PR https://github.com/mysticalsin/aria-sourcing/pull/150
- **#150:** squash auto-merge on, **REVIEW_REQUIRED**
- **Tip fix:** campaign-agents-panel soft-nav `pollGeneration` — stale refresh cannot paint foreign/empty durableSeats
- **Fly:** still `21a42e7…` / `0084` / `hermesRuntime:true`
- **Goal:** **open** until Fly tip SHA + LI desks healthy

## Done this shift

1. Fixed Agents panel soft-nav race (pollGeneration invalidate in-flight refresh)
2. Soft-nav attach suite covers pollGeneration guard (14/14)
3. Cleaned HANDOFF conflict markers from cherry-pick

## Blockers

1. Owner approve #150 → squash → dispatch + proof + LI healthy

## Next steps

1. Owner approve #150 + dispatch + `bash scripts/fly-n-agent-proof.sh` + LI Take→login→Release
2. **do not UpdateGoal complete** until tip SHA + 0087 + LI desks healthy

## Decisions (don't relitigate)

- Tip N-agent class closed except production Fly + LI; Hermes deploy gates clear
- Never invent sessionHealthy=true
- Ignore Vercel-only CI when Quality/Release pass
- campaignId on Take/resolve/boot only when seat already attached

## Watch out

- No agent review/approve / FLY_API_TOKEN
- Docs/code pushes cancel CI — re-verify green before owner merge
