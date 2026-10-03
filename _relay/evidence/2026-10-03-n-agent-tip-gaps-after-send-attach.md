# N-agent tip gaps AFTER send-attach (updated after G1–G4 fix)

## Status

| # | Class | Status |
|---|---|---|
| G1 | dispatch blank campaign_id | **Fixed** — BC requires campaign id + attach |
| G2 | merge injects campaignId | **Fixed** — durable assigned only |
| G3 | checklist soft-nav stale durable | **Fixed** — clear computers + durableSeats on change/fail/catch |
| G4 | agents health badge scope | **Fixed** — campaignSeats-scoped counts + clear on campaign change |

## Watch out

- Tip CI green ≠ production N-agent complete (Fly still stale; owner).
