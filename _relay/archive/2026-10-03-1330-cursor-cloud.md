---
project: MSourcing / ARIA
shift: 299
agent: cursor-cloud
updated: 2026-10-03T13:25Z
status: tip-packetfx-attach-fly-stale
---

# Handoff — Shift 299

## Current state

- **Branch:** `cursor/linkedin-human-claude-chrome-b91d`
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/148
- **Tip:** `9d6d50a` — PacketFX/ticker LI attach gate; viewport ingest
- **Fly:** still `21a42e7…` / `0084` / `agentFrameworks:false`
- **Goal:** open until Fly tip SHA + LI desks healthy

## Done this shift

1. PacketFX / ActivityTicker require LI campaign attach (match Floor pulse)
2. Viewport fleet poll ingests durable bindings
3. Roster progress step 3 email-only (no LI mode=live theater)
4. tsc + unit contracts green

## Blockers

1. Owner Fly tip redeploy + LI healthy

## Next steps

1. Owner Fly tip SHA + LI healthy — do not UpdateGoal complete

## Decisions (don't relitigate)

- Empty campaignSeats / browserSeatBindings authority; Hermes ingest fail-closed stubs
- liveSeats excludes Browser Computer
- LI FX/pulse/ticker require campaign attach
- Never invent sessionHealthy=true
- Tip CI green ≠ production N-agent goal complete
- Ignore Vercel-only CI when Quality/Release pass

## Watch out

- Protected deploy: `deploy/fly-github-actions`
