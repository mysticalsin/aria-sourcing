# N-agent tip gaps AFTER 8995ec7 — read-only audit

Tip: `8995ec7`. Skip Fly/owner.

## Closed on tip (re-verified)

| Gap | Status |
|---|---|
| G1–G4 soft-nav / blank-campaign BC | Fixed (`1ff61fc`) |
| send / dispatch / enqueue 0086 / preferred attach | Fixed |
| Campaign-scoped allocate `seatPool = campaignSeats` | Fixed (`b9677dd`) |
| Approve empty-seatId attach filter | Fixed (`b9677dd`) |
| Unscoped allocate draft loop attach | Fixed (`8995ec7`) |
| Approve stamped seatId attach | Fixed (`8995ec7`) |

## Remaining tip code gaps

| # | File:line | Issue | One-line fix | Conf |
|---|---|---|---|---|
| R1 | `src/lib/store.ts:2211-2215` | `draftFollowUpFor` LinkedIn seat = `soleCampaignBrowserSeatId` only — ignores prior desk; N>1 → seatless draft → approve blocks | `seatId ?? latestOutreachSeatId(...) ?? sole...` + fail-closed if still missing && N>1 | high |
| R2 | `src/lib/store.ts:2279-2283` | Same for `draftRecontactFor` | Same as R1 | high |
| R3 | `src/app/campaigns/[id]/page.tsx:609` | Post-source LinkedIn draft calls `generateOutreachFor` without seatId; N>1 attached BC → 0 drafts | Use `allocateOutreach({ campaignId: c.id })` (or pass attached seatId) | high |
| R4 | `src/app/api/outreach/send/route.ts:273` | Attach gate is BC-only; Vendor with foreign `assigned_campaign_ids` can still enqueue | Require `seatAttachedToCampaign` for both automatic LI providers | med |
| R5 | `src/lib/dispatch-outbound.ts:371` | Same Vendor foreign-attach skip | Extend attach block beyond BC (helper already imported) | med |
| R6 | `supabase/migrations/0086_…sql:70` | Same Vendor foreign-attach skip in enqueue RPC | Apply attach check for Vendor when assigned non-empty (or always via same rules as helper) | med |

## Not gaps (intentional / out of scope)

- `generateOutreachFor` N>1 without seatId → null (anti-bleed; Fleet allocate is the N distributor).
- Floor/cortex BC empty → idle; campaign agents soft-nav clear; go-live merge no inject.
- Fly tip SHA / LI healthy — owner.

## Verdict

Attach bleed class from wire audit + 8995ec7 is closed for BC allocate/approve/send.
**Remaining tip wiring:** follow-up/recontact + campaign post-source draft paths do not stamp N desks; Vendor server attach lags client approve.
