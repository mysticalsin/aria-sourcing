---
project: MSourcing / ARIA
shift: 269
agent: cursor-cloud
updated: 2026-10-03T07:20Z
status: tip-audit-send-attach-bleed
---

# Handoff — Shift 269

## Current state

- **Branch:** `cursor/linkedin-human-claude-chrome-b91d`
- **Tip:** `b9677dd` — allocate/approve attach fail-closed
- **Audit:** empty-BC bleed remains on send/dispatch/enqueue (+ preferred stamp bypass)
- **Fly:** still stale — skip (owner)

## Done this shift

1. Read-only tip audit after `b9677dd` (six gap classes)
2. Evidence: `_relay/evidence/2026-10-03-n-agent-wire-audit.md`

## Blockers

1. Owner Fly tip redeploy + LI healthy (unchanged)

## Next steps

1. Gate BC send: `send/route.ts` + `dispatch-outbound.ts` + `enqueue_linkedin_outbound` require `assigned_campaign_ids` includes campaign
2. Harden `pickLiveLinkedInSendSeat` preferred path for BC attach (update preferred test)
3. Do not UpdateGoal complete until Fly tip + LI healthy

## Decisions (don't relitigate)

- LI Browser empty assigned ≠ attached
- Campaign-scoped allocate never falls back to all desks
- Never invent sessionHealthy=true
- Never commit ARIA_JINA_API_KEY
- Go-live requires computerForSeat (never Hermes-only)

## Watch out

- Client allocate/approve green ≠ durable send attach enforced
- Tip CI green ≠ production N-agent goal complete
