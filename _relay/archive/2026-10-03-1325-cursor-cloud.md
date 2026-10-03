---
project: MSourcing / ARIA
shift: 298
agent: cursor-cloud
updated: 2026-10-03T13:20Z
status: tip-liveSeats-ingest-polls-fly-stale
---

# Handoff — Shift 298

## Current state

- **Branch:** `cursor/linkedin-human-claude-chrome-b91d`
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/148
- **Tip:** `273a327` — liveSeats excludes LI; Setup/go-live/badge ingest
- **Fly:** still `21a42e7…` / `0084` / `agentFrameworks:false`
- **Goal:** open until Fly tip SHA + LI desks healthy

## Done this shift

1. fleetSummary liveSeats = email domain-verified only (LI via sessionHealthy strip/Floor)
2. Setup Guide, Go-live checklist, campaign Agents badge poll → ingestDurableBrowserBindings
3. tsc + npm test green

## Blockers

1. Owner Fly tip redeploy + LI healthy

## Next steps

1. Owner Fly tip SHA + LI healthy — do not UpdateGoal complete

## Decisions (don't relitigate)

- Empty campaignSeats only after successful seats query; `durable: []` ≠ missing
- Unscoped GET emits `browserSeatBindings`; Hermes ingest may append fail-closed stubs
- liveSeats metric excludes Browser Computer (sessionHealthy path)
- Never invent sessionHealthy=true
- Tip CI green ≠ production N-agent goal complete
- Ignore Vercel-only CI when Quality/Release pass

## Watch out

- Protected deploy: `deploy/fly-github-actions`
