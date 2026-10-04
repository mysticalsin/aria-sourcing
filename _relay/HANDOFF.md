---
project: MSourcing / ARIA
shift: 368
agent: cursor-cloud
updated: 2026-10-04T07:05Z
status: tip-restore-family-query-awaiting-ci-approve
---

# Handoff — Shift 368

## Current state

- **Branch tip:** pending — restore probe/control-family single `actions[]` query
- Prior tip `19a71ed` / feature `32b1bfe`: Quality+Release SUCCESS; Vercel FAILURE (ignore); still `REVIEW_REQUIRED`
- 9th residual ([Hunt restore limit residual](bc-206e25fa-b16b-5adc-98b0-2fd5f4998265)) → fixed
- Fly still `21a42e7` / `0084`

## Done this shift

1. Confirmed tip CI Quality+Release green on `19a71ed`
2. `ComputerAuditQuery.actions[]` + durable `.in("action")`
3. restoreSessionHealth: one probe-family + one control-family stream (no split invent-green)
4. Local: tsc + computer-supervisor 189 + computer-audit 23

## Blockers

1. Owner Approve #150 → squash → Deploy → fly-n-agent-proof → LI Take→login→Release
2. Never invent sessionHealthy; UpdateGoal complete only after tip + ≥0087–0090 + LI healthy

## Next steps

1. Tip CI green (ignore Vercel-only)
2. Owner Approve; deploy; proof; LI health

## Decisions made (don't relitigate)

- Restore uses family `actions[]` streams — never split probe/fail or takeover/release caps
- Ignore Vercel rate-limit when Quality/Release pass

## Watch out

- Fingerprint pin; no agent Approve / FLY_API_TOKEN / workflow_dispatch
