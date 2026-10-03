# N-agent tip gaps AFTER send-attach (3402c29 / 9da64d3)

Scope: empty BC bleed, theater, wrong computer, sessionHealthy invent, Hermes go-live, poll stale, allocate/approve fallback. Skip Fly/owner.

Tip audited: `3c76ff4` (docs) / send-attach land `9da64d3`+`3402c29`.

## Remaining gaps (concrete)

| # | Class | File:line | One-line fix | Conf |
|---|---|---|---|---|
| G1 | empty BC bleed (dispatch) | `src/lib/dispatch-outbound.ts:371-378` | Fail-closed when BC and `!attachCampaignId` (same as enqueue 0086 `campaign-required`), not only when attach id present and mismatched | high |
| G2 | Hermes go-live / poll stale / wrong computer | `src/lib/campaign-go-live.ts:71` | Stop appending `campaignId` into `assigned` — trust durable `assignedCampaignIds` only (API already filtered) | high |
| G3 | poll stale / Hermes go-live | `src/components/campaigns/campaign-go-live-checklist.tsx:38-40` (+ effect start / catch) | On campaignId change, `!res.ok`, and catch: `setPolledComputers([])` **and** `setDurableSeats(undefined)` before/instead of leaving prior campaign paint | high |
| G4 | poll stale / theater | `src/components/campaigns/campaign-agents-panel.tsx:423` | Scope `healthyCount`/`unverifiedCount` to `campaignSeats` seatIds; clear `computers` when `campaignId` changes | med |

### G2+G3 repro

App Router soft-nav `/campaigns/A` → `/campaigns/B` reuses checklist state (no `key={c.id}`). Stale `durableSeats`+`polledComputers` from A + merge injects B at `:71` → `evaluateCampaignGoLive` can paint ready for B using A's healthy desks until the next successful poll.

### G1 repro

`messages_outbound.campaign_id` null/blank for a BC seat (pre-0086 queue or bad row): attach `if (attachCampaignId && …)` is skipped → dispatch may deliver.

## Closed on tip (NONE)

| Class | Verdict | Conf |
|---|---|---|
| allocate fallback to all seats | NONE — `store.ts:5271-5274` `seatPool = campaignSeats` | high |
| approve sole-stamp empty BC | NONE — `store.ts:2607-2630` `seatAttachedToCampaign` only | high |
| send route / preferred / enqueue 0086 attach | NONE — gated in `9da64d3` | high |
| sessionHealthy invent (release/mock/restore) | NONE — probe/`meta.healthy===true` only; mockSend does not bypass linkedin_send | high |
| floor zero-send working theater | NONE — busy/ready+healthy+sentToday=0 → idle | high |
| Hermes-only go-live without fleet bind | NONE — `evaluateCampaignGoLive` requires `computerForSeat` | high |
| Floor/Fleet/Setup/HealthStrip poll fail clear | NONE — clear map / null health / false | high |

## Watch out

- Tip CI green ≠ production N-agent complete (Fly still stale; owner).
- Stale open rows in `_relay/codex-findings.md` (busy unverified / mockSend / with-VM Hermes) are superseded by tip fixes; do not re-open from that file alone.
