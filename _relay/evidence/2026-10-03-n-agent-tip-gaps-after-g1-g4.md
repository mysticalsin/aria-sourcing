# N-agent tip gaps AFTER G1–G4 (1ff61fc / c1e3b9b)

Scope: tip code only. Skip Fly/owner. Prior closed: send-attach 0086, allocate/approve attach (campaign-scoped), G1–G4.

## Closed (re-verified)

| Path | Status |
|---|---|
| G1 dispatch blank campaign_id | Fixed — BC requires campaign id + attach |
| G2 merge inject campaignId | Fixed — durable assigned only |
| G3 checklist soft-nav durable | Fixed — clear computers + durableSeats |
| G4 agents health badge scope | Fixed — campaignSeats-scoped + clear on change |
| send / enqueue 0086 BC attach | Fixed |
| campaign-scoped allocate seatPool | Fixed (`seatPool = campaignSeats`) |
| approve empty-seatId stamp | Fixed (attached only) |

## Remaining tip code gaps

### 1. Unscoped Fleet allocate stamps foreign / unattached BC desks
**File:** `src/lib/store.ts:5271-5273` (draft stamp `5292-5303`; picker `src/lib/fleet.ts:249-261`)
**Issue:** When `opts.campaignId` is missing, `seatPool = activeSeats` and `allocateBatch` capacity-picks any BC for any candidate campaign. Fleet UI defaults scope to "" ("whole fleet") and does not require a campaign (unlike sourcing).
**Repro:** Two campaigns A/B; BC attached only to A; Fleet Allocate with no scope → candidate from B drafted with A's seatId (or empty-assigned BC).
**Fix:** In the draft loop, skip unless `seatAttachedToCampaign(seat, campaign.id)` (or require campaignId like sourcing).

### 2. Approve skips attach when seatId already set
**File:** `src/lib/store.ts:2605`
**Issue:** `seatAttachedToCampaign` runs only for empty `msg.seatId`. Foreign BC stamped by (1) (or detach-after-draft) still approves onto the ledger; send later 409s.
**Fix:** When LinkedIn + seatId set, require `seatAttachedToCampaign(seat, campaign.id)` or block.

## Verdict

Not NONE — 2 tip gaps above. Send/dispatch/enqueue/campaign-scoped allocate + G1–G4 soft-nav remain closed.
