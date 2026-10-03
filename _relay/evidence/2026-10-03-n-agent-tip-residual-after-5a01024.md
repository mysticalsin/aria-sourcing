# N-agent tip residual — after durable go-live/Setup/Agents (`5a01024`)

**Tip base:** `5a01024` / docs `1e5c05e`  
**Hunt:** post-fix pass (bc-7f1a1bd7)

## Findings

| File:line | Fix | Status |
|---|---|---|
| `src/app/campaigns/[id]/page.tsx` Agents tab count | Prefer durable `campaignSeats.length` when present; Hermes via `isBrowserComputerSeat`+`seatAttachedToCampaign` only when durable omitted | **fixed this shift** |

## Closed on tip

- Go-live / Setup / Agents panel durable authority (`5a01024`)
- Attach gates, floor idle/pulse, campaignSeats fail-closed, soft-nav clear

## Out of scope

- Fly `21a42e7` / `0084` / `agentFrameworks:false` — owner redeploy
