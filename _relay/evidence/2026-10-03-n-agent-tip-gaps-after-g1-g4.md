# N-agent tip gaps AFTER G1–G4 — status

## Closed

| Gap | Status |
|---|---|
| G1–G4 soft-nav / blank campaign | Fixed (`1ff61fc`) |
| send/enqueue/preferred attach | Fixed |
| Unscoped Fleet allocate stamps foreign BC | **Fixed** — draft loop `seatAttachedToCampaign(seat, campaign.id)` |
| Approve skips attach when seatId set | **Fixed** — stamped seat must be attached |

## Watch out

- Tip CI green ≠ production N-agent complete (Fly still stale; owner).
