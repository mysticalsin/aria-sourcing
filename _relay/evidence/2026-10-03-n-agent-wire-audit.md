# N-agent FE↔BE wire audit — tip after send-attach gate (2026-10-03)

Scope: empty BC shared-pool bleed, wrong computer ops, floor theater, sessionHealthy invent, Hermes-only go-live, poll stale paint. Skip Fly/owner.

## Verdict

Client allocate/approve attach + durable send authority attach are closed on tip.
**Remaining production blocker:** Fly tip SHA + LI desks healthy (owner).

## Findings by gap class

### Empty BC shared-pool bleed
| Path | Status |
|---|---|
| allocate `seatPool = campaignSeats` | **Fixed** (`b9677dd`) |
| approve `seatAttachedToCampaign` only | **Fixed** (`b9677dd`) |
| send route selects `assigned_campaign_ids`, 409 if BC unattached | **Fixed** |
| dispatch `linkedin-seat-not-attached` | **Fixed** |
| `enqueue_linkedin_outbound` migration 0086 | **Fixed** |
| preferred send-seat requires attach | **Fixed** |

### Wrong computer ops / Floor theater / sessionHealthy invent / Hermes-only go-live / Poll stale paint
Superseded by `_relay/evidence/2026-10-03-n-agent-tip-gaps-after-send-attach.md` (G1–G4 remaining on tip).

## Watch out

- Tip CI green ≠ production N-agent goal complete until Fly tip + LI healthy
- Soft-nav go-live stale durable + merge inject campaignId (see tip-gaps evidence)
