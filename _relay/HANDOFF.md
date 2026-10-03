---
project: MSourcing / ARIA
shift: 330
agent: cursor-cloud
updated: 2026-10-03T19:20Z
status: detach-viewport-fixed-awaiting-owner-approve
---

# Handoff — Shift 330

## Current state

- **#150 tip:** Agents detach skips durable-bound seats (no LWW wipe other campaigns); viewport unboundOrphan requires loaded computer
- **#148:** port next
- **#150:** squash auto-merge on; owner approve still required
- **Fly:** `21a42e7…` / `0084` — goal open until tip SHA + 0087 + LI desks healthy

## Done this shift

1. Agents detach: skip seats present in durable bindings (ingest already applied)
2. Viewport: loading ≠ unbound reclaim theater; canDrive gated on computer loaded
3. Soft-nav 25/25

## Blockers

1. Owner approve #150 → squash → dispatch + proof + LI healthy

## Next steps

1. Port onto #148
2. Owner approve + dispatch + `bash scripts/fly-n-agent-proof.sh` + LI Take→login→Release
3. **do not UpdateGoal complete** until tip SHA + 0087 + LI desks healthy

## Decisions made (don't relitigate)

- Poll Hermes computerId local-only; detach PATCH never from Hermes when durable bindings exist
- Soft-nav / seatsRef / adoptDurable stack
- Never invent sessionHealthy=true
- Ignore Vercel-only CI when Quality/Release pass
- N-agent deploy does **not** require `agentFrameworks:true`

## Watch out

- No agent review/approve / FLY_API_TOKEN / request-reviewers
