---
project: MSourcing / ARIA
shift: 315
agent: cursor-cloud
<<<<<<< HEAD
updated: 2026-10-03T17:16Z
=======
updated: 2026-10-03T17:45Z
>>>>>>> fcf8943 (fix(agents): invalidate in-flight fleet refresh on soft-nav)
status: tip-n-agent-closed-fly-blocks-goal
---

# Handoff — Shift 315

## Current state

<<<<<<< HEAD
- **Deploy-land tip:** `cursor/fly-deploy-land-n-agent-b91d` @ `cb142f2` (N-agent code tip still `150b58a` + relay)
- **#150:** squash auto-merge on; owner approve still required
- **Adversarial tip pass (4 surfaces):** **NONE** — see `_relay/evidence/2026-10-03-n-agent-adversarial-four-surface.md`
- **Fly:** still pre-tip; goal open until tip SHA + 0087 + LI desks healthy

## Done this shift

1. Medium adversarial re-audit of Floor durable desks / sessionHealthy invent / Deploy campaignId / live-poll ingest
2. Confirmed known-closed tip wiring still holds; no new open findings

## Blockers

1. Owner approve #150 → squash → CI on deploy HEAD → dispatch + proof + LI healthy
=======
- **Deploy-land:** `cursor/fly-deploy-land-n-agent-b91d` — PR https://github.com/mysticalsin/aria-sourcing/pull/150
- **#150:** squash auto-merge on, **REVIEW_REQUIRED**; tip was green at `399d90e` before this fix
- **Tip fix:** campaign-agents-panel soft-nav pollGeneration — stale refresh cannot paint foreign/empty durableSeats
- **Fly:** still `21a42e7…` / `0084` / `hermesRuntime:true`
- **Goal:** **open** until Fly tip SHA + LI desks healthy

## Done this shift

1. Fixed Agents panel soft-nav race (pollGeneration invalidate in-flight refresh)
2. Soft-nav attach suite 14/14

## Blockers

1. Owner approve #150 → squash → dispatch + proof + LI healthy
>>>>>>> fcf8943 (fix(agents): invalidate in-flight fleet refresh on soft-nav)

## Next steps

1. Owner approve #150 + dispatch + `bash scripts/fly-n-agent-proof.sh` + LI Take→login→Release
2. **do not UpdateGoal complete** until tip SHA + 0087 + LI desks healthy

## Decisions (don't relitigate)

<<<<<<< HEAD
- Tip N-agent class closed on tip; production incomplete until Fly tip + LI healthy
=======
- Tip N-agent class closed except production Fly + LI; Hermes deploy gates clear
>>>>>>> fcf8943 (fix(agents): invalidate in-flight fleet refresh on soft-nav)
- Never invent sessionHealthy=true
- Ignore Vercel-only CI when Quality/Release pass
- campaignId on Take/resolve/boot only when seat already attached

## Watch out

<<<<<<< HEAD
- No agent review/approve / FLY_API_TOKEN / request-reviewers
- Docs pushes cancel CI — re-verify green before dispatch on deploy HEAD
=======
- No agent review/approve / FLY_API_TOKEN
- Docs/code pushes cancel CI — re-verify green before owner merge
>>>>>>> fcf8943 (fix(agents): invalidate in-flight fleet refresh on soft-nav)
