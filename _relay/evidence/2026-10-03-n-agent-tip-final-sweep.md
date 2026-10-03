# N-agent tip final sweep — closed

Findings from explore at `b1ec26e` closed on tip:

| Gap | Fix |
|---|---|
| GET campaignSeats:[] on seats error | 500 `agent-seats-unavailable`; omit key unless seats array |
| Agents detach-all on error [] | Only sync when campaignSeats present |
| Hermes∪durable badge seatIds | durable⊇ only when campaignSeats present |
| Setup LI healthy soft-nav sticky | clear `setLiSessionHealthy(false)` at effect start |

Fly still blocks production goal.
