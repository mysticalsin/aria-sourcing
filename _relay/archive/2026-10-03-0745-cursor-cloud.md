---
project: MSourcing / ARIA
shift: 272
agent: cursor-cloud
updated: 2026-10-03T07:44Z
status: tip-audit-gaps-after-send-attach
---

# Handoff — Shift 272

## Current state

- **Branch:** `cursor/linkedin-human-claude-chrome-b91d`
- **Tip:** `3c76ff4` (+ relay evidence this shift)
- **Send-attach gates:** landed `9da64d3` / fingerprint `3402c29`
- **Read-only tip audit:** `_relay/evidence/2026-10-03-n-agent-tip-gaps-after-send-attach.md` — **4 remaining code gaps** (not Fly)

## Done this shift

1. Thorough tip audit after send-attach for N-agent real/visible/wired gaps
2. Evidence: G1 dispatch empty campaign_id; G2 go-live inject campaignId; G3 checklist poll stale durable; G4 agents healthyCount scope

## Blockers

1. Owner Fly tip redeploy (0086) + LI healthy (unchanged; skipped this audit)

## Next steps

1. Fix G1–G3 (high): dispatch fail-closed without campaign_id; stop merge inject; clear durableSeats on poll fail/campaign change
2. Fix G4 (med): scope Campaign Agents health badges; clear computers on campaignId change
3. Owner Fly tip SHA + LI desks healthy
4. Do not UpdateGoal complete until Fly tip + LI healthy

## Decisions (don't relitigate)

- LI Browser empty assigned ≠ attached on allocate/approve/send/enqueue
- Never invent sessionHealthy=true
- Never commit ARIA_JINA_API_KEY
- Tip CI green ≠ production N-agent goal complete

## Watch out

- Soft-nav campaign A→B can green go-live from stale durable+computers while merge injects new campaignId
- Stale "open" codex rows for mockSend/busy-unverified/with-VM Hermes are tip-fixed; trust tip code + this evidence
