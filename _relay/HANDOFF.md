---
project: MSourcing / ARIA
shift: 332
agent: cursor-cloud
updated: 2026-10-03T19:25Z
status: orphan-hydrate-adopt-fixed-fly-blocks-goal
---

# Handoff — Shift 332

## Current state

- **#148 tip:** GET/POST hydrate treat `computer-orphan-claim-blocked` like ownership-mismatch → adoptDurable (no fleet 500)
- **#150:** port next; owner approve still required
- **Fly:** `21a42e7…` / `0084` — goal open until tip SHA + 0087 + LI desks healthy

## Done this shift

1. Fixed multi-instance orphan Map vs durable FK: adoptDurable instead of rethrow 500
2. computer-supervisor 134/134

## Blockers

1. Owner approve #150 → squash → dispatch + proof + LI healthy

## Next steps

1. Port onto #150
2. Owner approve + dispatch + `bash scripts/fly-n-agent-proof.sh` + LI Take→login→Release
3. **do not UpdateGoal complete** until tip SHA + 0087 + LI desks healthy

## Decisions made (don't relitigate)

- Durable Map conflicts (ownership-mismatch OR orphan-claim-blocked) adopt when no other DB seat claims id
- Poll Hermes computerId local-only; detach skips durableById
- Never invent sessionHealthy=true
- Ignore Vercel-only CI when Quality/Release pass
- N-agent deploy does **not** require `agentFrameworks:true`

## Watch out

- No agent review/approve / FLY_API_TOKEN / request-reviewers
