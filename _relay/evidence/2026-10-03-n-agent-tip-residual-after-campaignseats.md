# N-agent tip residual hunt — after campaignSeats (`654d988` / `6bc0640`)

**Tip:** `cursor/linkedin-human-claude-chrome-b91d`  
**Scope:** tip-code honesty / isolation / visibility only. Skip Fly/owner, Vercel.  
**Already closed (not re-reported):** attach/send/dispatch/0086/0087/soft-nav/R1–R6/floor idle/pulse/confirm-manual/fleet POST/campaignSeats authority/Setup soft-nav clear/ponytail `seatAttachedToCampaign`  
**Invariant:** never invent `sessionHealthy=true` — tip probe/TTL paths still hold.

## Findings → fixed

| File:line | Fix | Status |
|---|---|---|
| `src/lib/campaign-go-live.ts` | `durable: []` authority-empty (return `[]`); only `undefined` Hermes-fallback | **fixed** |
| `src/components/settings/setup-guide-panel.tsx` | Poll `?campaignId=` + gate attach/LI healthy on durable `campaignSeats` ∩ `sessionHealthy===true` | **fixed** |
| `src/components/campaigns/campaign-agents-panel.tsx` | Cards/counts from `mergeDurableCampaignSeatsForGoLive` when durable present | **fixed** |

## Closed on tip (spot-check)

- No production invent of `sessionHealthy=true` (probe / durable `meta.healthy===true` / TTL expire only).
- Fleet GET omits `campaignSeats` on seats error; Agents skip detach-all when key absent.
- Floor idle honesty + attributed pulse + PacketFX seatId fail-closed remain.

## Out of scope

- Owner Fly tip redeploy (`21a42e7` / `0084` / `agentFrameworks:false`) + live LI desks — see `2026-10-03-fly-owner-deploy-blocker.json`.
