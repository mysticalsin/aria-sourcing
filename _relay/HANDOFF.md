---
project: MSourcing / ARIA
shift: 293
agent: cursor-cloud
updated: 2026-10-03T12:11Z
status: tip-agents-tab-durable-fly-stale
---

# Handoff — Shift 293

## Current state

- **Branch:** `cursor/linkedin-human-claude-chrome-b91d`
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/148
- **Tip:** `4c4a53a` — Agents tab badge prefers durable campaignSeats length
- **Fly:** still `21a42e7…` / `0084` / `agentFrameworks:false`
- **Goal:** open until Fly tip SHA (0085–0087) + LI desks healthy

## Done this shift

1. Reprobed Fly — still stale; no `FLY_API_TOKEN`
2. Post-5a01024 residual hunt → Agents tab Hermes-only badge; fixed
3. `tsc` + soft-nav + `npm test` green

## Blockers

1. Owner Fly tip redeploy + LI healthy

## Next steps

1. Owner Fly tip SHA + LI healthy — do not UpdateGoal complete

## Decisions (don't relitigate)

- Empty campaignSeats only after successful seats query; `durable: []` ≠ missing
- Shared isBrowserComputerSeat / seatAttachedToCampaign
- Never invent sessionHealthy=true
- Tip CI green ≠ production N-agent goal complete
- Ignore Vercel-only CI when Quality/Release pass

## Watch out

- Protected deploy: `deploy/fly-github-actions`
