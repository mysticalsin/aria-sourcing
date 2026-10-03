---
project: MSourcing / ARIA
shift: 276
agent: cursor-cloud
updated: 2026-10-03T08:36Z
status: tip-audit-post-8995ec7-remaining-gaps
---

# Handoff — Shift 276

## Current state

- **Branch:** `cursor/linkedin-human-claude-chrome-b91d`
- **Tip:** `8995ec7` — unscoped allocate + approve stamped attach closed
- **Audit:** `_relay/evidence/2026-10-03-n-agent-tip-gaps-after-8995ec7.md`
- **Fly:** still stale (owner; skip)

## Done this shift

1. Read-only tip audit after 8995ec7 (G1–G4, send-attach 0086, allocate/approve attach re-verified closed)
2. Found remaining tip gaps R1–R6 (follow-up/recontact seat, post-source N draft, Vendor server attach)

## Blockers

1. Owner Fly tip redeploy + LI healthy (not tip code)

## Next steps

1. Fix R1–R2: `draftFollowUpFor` / `draftRecontactFor` use `latestOutreachSeatId` then sole; fail-closed N>1
2. Fix R3: campaigns post-source use `allocateOutreach({ campaignId })` for N desks
3. Fix R4–R6: Vendor foreign attach on send/dispatch/0086 via `seatAttachedToCampaign`
4. Owner Fly tip SHA + 0086 + LI healthy

## Decisions (don't relitigate)

- Whole-fleet allocate is not exempt from BC/Vendor attach per candidate campaign
- Approve never greens foreign stamped seatId
- `generateOutreachFor` N>1 without seatId → null is intentional; Fleet allocate distributes
- Never invent sessionHealthy=true
- Never commit ARIA_JINA_API_KEY

## Watch out

- Tip CI green ≠ production N-agent goal complete
- Follow-up seatless drafts look like success until approve blocks
