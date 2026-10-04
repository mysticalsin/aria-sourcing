---
project: MSourcing / ARIA
shift: 367
agent: cursor-cloud
updated: 2026-10-04T06:55Z
status: tip-busy-mutex-residuals-awaiting-ci-approve
---

# Handoff — Shift 367

## Current state

- **Branch tip:** pending — stuck busy clear + probe/reclaim refuse busy (`32b1bfe`+)
- Prior tip `2f82edc` / feature `d50fbb8`: full CI green incl Vercel; still `REVIEW_REQUIRED`
- 8th residual ([Eighth residual hunt](bc-69fd851b-9101-508c-add2-cc2d6f5b4f9c)) → fixed (busy stuck + mid-busy probe)
- Fly still `21a42e7` / `0084`

## Done this shift

1. Confirmed tip CI full green on `2f82edc` (Quality+Release+Vercel)
2. `releaseControl` clears stuck `busy`→ready; humanMutex catch clears busy
3. `probeSession` throws `computer-busy`; route session_probe/reclaim 409 on busy
4. Local: tsc + computer-supervisor 187 pass

## Blockers

1. Owner Approve #150 → squash → Deploy → fly-n-agent-proof → LI Take→login→Release
2. Never invent sessionHealthy; UpdateGoal complete only after tip + ≥0087–0090 + LI healthy

## Next steps

1. Tip CI green on this residual (ignore Vercel-only if rate-limit)
2. Owner Approve; deploy; proof; LI health

## Decisions made (don't relitigate)

- Invalidate stamps probedAt so durable restore cannot re-green from older probe
- Floor refresh never probes busy; probeSession/reclaim also refuse busy
- Release/humanMutex unstick busy so Floor can re-probe after Take mid-send
- Durable audit reads merge memory when PG is configured

## Watch out

- restoreSessionHealth workspace-wide limit 200 under huge N (yellow from hunt8) — not fixed this shift
- Fingerprint pin; no agent Approve / FLY_API_TOKEN / workflow_dispatch
