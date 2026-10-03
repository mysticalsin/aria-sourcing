---
project: MSourcing / ARIA
shift: 266
agent: cursor-cloud
updated: 2026-10-03T06:30Z
status: n-agent-wire-audit-done
---

# Handoff — Shift 266

## Current state

- **Branch:** `cursor/linkedin-human-claude-chrome-b91d`
- **Tip commit:** `211a8ee` (CI green; Fly still stale — skip per this audit)
- **Audit:** `_relay/evidence/2026-10-03-n-agent-wire-audit.md`
- **WIP (other agent, do not discard):** `src/lib/campaign-seat-attach.ts` (untracked) + dirty `agent-event-seat.ts` / `linkedin-automatic.ts` / `store.ts` / matching tests — partial F1 fix

## Done this shift

1. Read-only N-agent FE↔BE wire audit (attach, seatId↔computerId, floor↔fleet, go-live/ops, Hermes sync, isolation)
2. Wrote evidence file with concrete file:line + one-line fixes

## Blockers

1. F1 still open on tip: empty `assignedCampaignIds` = shared pool for LI Browser on allocate/send/sole-stamp/source pulses
2. Fly tip deploy still owner-gated (out of scope this ask)

## Next steps

1. Finish F1: wire `seatAttachedToCampaign` everywhere; remove `store.ts` allocate fallback to all seats; remove approve `liLive.length===1` soleAuto fallback; land + test
2. Do not UpdateGoal complete until Fly tip SHA + LI healthy (unchanged)

## Decisions (don't relitigate)

- Never invent sessionHealthy=true
- Empty assignedCampaignIds is NOT attached for LinkedIn Browser Computer (Setup/Go-live/Floor already; store/send/FX must match)
- Go-live requires computerForSeat (never Hermes-only)
- Physical VM isolation on tip is real; remaining gap is campaign-membership enforcement

## Watch out

- Uncommitted WIP partially implements F1 — complete it, don't revert
- Tip CI green ≠ production N-agent goal complete
