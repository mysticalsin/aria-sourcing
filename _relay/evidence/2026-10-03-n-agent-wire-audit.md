# N-agent FE↔BE wire audit — tip `b9677dd` (2026-10-03)

Scope: empty BC shared-pool bleed, wrong computer ops, floor theater, sessionHealthy invent, Hermes-only go-live, poll stale paint. Skip Fly/owner.

## Verdict

Client allocate/approve attach holes from prior audit are closed on tip (`b9677dd`).
**Still open:** durable LinkedIn send authority (API + dispatch + enqueue RPC) does not enforce BC `assigned_campaign_ids`; preferred send-seat stamp can still bypass attach.

## Findings by gap class

### Empty BC shared-pool bleed
| File:line | Issue | One-line fix |
|---|---|---|
| `src/app/api/outreach/send/route.ts:249` | LI seat select omits `assigned_campaign_ids`; any live BC `seatId` can enqueue for any `campaignId` | Select `assigned_campaign_ids`; refuse BC when `!(assigned ?? []).includes(campaignId)` |
| `src/lib/dispatch-outbound.ts:356` | After seat load, BC send proceeds without `seatAttachedToCampaign(seat, campaignId)` | Block with `linkedin-seat-not-attached` when BC and campaignId set but not attached |
| `supabase/migrations/0080_contact_lease_and_browser_computer.sql:341` (live `enqueue_linkedin_outbound`) | RPC allows BC enqueue with empty/foreign `assigned_campaign_ids` | New migration: for `LinkedIn Browser Computer`, require `p_campaign_id = any(seat.assigned_campaign_ids)` |
| `src/lib/linkedin-automatic.ts:60` | `preferredSeatId` returns live automatic seat without attach check (empty/foreign BC still wins if stamped) | For BC + campaignId, require `seatAttachedToCampaign` else `undefined` (update preferred test) |

Allocate/approve client paths: **closed** (`store.ts` `seatPool = campaignSeats`; approve only `seatAttachedToCampaign`).

### Wrong computer ops
**NONE.** POST ownership (`callerSeatId === boundSeatId`); Campaign/Fleet/viewport ops send owning `seatId`; floor/go-live refuse orphan/foreign.

### Floor theater
**NONE.** Empty `computerHints` Map fail-closed; busy+healthy zero-sends → idle; pulse cannot invent working from idle+healthy; cortex short-circuits idle/paused/warming.

### sessionHealthy invent
**NONE.** Probe/`meta.healthy===true` only; GET refresh / durable restore fail-closed; UI overlays null on miss.

### Hermes-only go-live
**NONE.** `evaluateCampaignGoLive` always `computerForSeat(fleet)` with `computers ?? []`; checklist poll fail → `[]`.

### Poll stale paint
**NONE.** Floor/Fleet/Agents/HealthStrip/Setup clear on `!ok`/catch; LinkedIn Settings HTTP-fail nulls health (catch rebuilds seats without fleet overlay).

## Prior F1–F6 (still hold except send-authority bleed above)
F2–F5 remain NONE. F1 allocate/approve fixed in `b9677dd`. F6 Chromium isolation still NONE; remaining logical bleed is send-authority attach above.
