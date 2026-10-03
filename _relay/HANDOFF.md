---
project: MSourcing / ARIA
shift: 232
agent: cursor-cloud
updated: 2026-10-03T01:36Z
status: booking-trail-seat-computer-fly-stale
---

# Handoff — Shift 232

## Current state

- **Branch:** `cursor/linkedin-human-claude-chrome-b91d` @ tip (pending commit)
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/148
- **Agent Reach:** slices 1–3.5 ✅; slice 4 ❌ Fly+LI
- **N-agent:** singleton + durable probe + campaignSeats + Floor busy honest + booking.proposed seat/computer trail + go-live durable seat merge
- **Fly live:** build `21a42e7…`, `agentFrameworks:false`; no deploy token
- **Tip CI:** pending/queued on `f24d680` (pre this commit)

## Done this shift

1. `resolveInboundSeatComputer` — LinkedIn events / ledger → agent_seats; booking.proposed + activity notes carry seat/computer (or honest —)
2. Go-live: `mergeDurableCampaignSeatsForGoLive` — DB campaignSeats authority when Hermes cold
3. Tests: sourcing-loop-worker 20/20; campaign-go-live 19/19; tsc clean

## Blockers

1. No Fly deploy token
2. Operator Take→login→Release after tip deploy

## Next steps

1. Owner Fly redeploy tip until `/api/ready` tip SHA + `agentFrameworks:true`
2. Operator LI login; prove sessionHealthy on Floor + Campaign Agents
3. Confirm tip Quality when CI runners pick up tip

## Decisions (don't relitigate)

- Never invent sessionHealthy=true
- Busy/starting VM ≠ probed healthy — no theatrical working labels
- Durable DB campaign↔seat bindings are Campaign Agents / go-live authority
- Agent Reach = eyes; OpenBot = hands; booking propose ≠ silent createBookingFor
- Booking trail must carry seatId/computerId when resolvable (R4)

## Watch out

- Do not mark N-agent goal complete until Fly tip SHA + LI healthy verified
- profiles `.from()` mocks in worker tests must stay table-aware when adding seat lookups
