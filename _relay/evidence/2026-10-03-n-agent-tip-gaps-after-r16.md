# N-agent tip gaps AFTER R1–R6 — tip `b6c1063` (post-`efbaf99`)

**Scope:** Remaining tip-code isolation / honesty / visibility / wiring gaps.
**Skip:** Fly/owner deploy; Vercel rate-limit; already-closed sessionHealthy / G1–G4 / send-attach 0086 / R1–R6 / Vendor CI fingerprint.

## Tip under audit

- Branch: `cursor/linkedin-human-claude-chrome-b91d`
- Requested ~`efbaf99`; HEAD at audit: `b6c1063` (`fix(fleet): refuse foreign seatId on generateOutreach draft paths`)

## Closed (do not re-report)

| Area | Evidence |
|---|---|
| sessionHealthy fail-closed; BC empty≠attached; Vendor empty=shared | `campaign-seat-attach.ts`, floor/cortex idle, go-live |
| allocate/approve attach (incl. unscoped + stamped seatId) | `store.ts` allocateOutreach / approveOutreach |
| soft-nav bleed G1–G4 | `campaign-go-live.ts`, checklist, agents panel, `tests/campaign-soft-nav-attach.mts` |
| send/dispatch/enqueue BC+Vendor attach | `outreach/send/route.ts`, `dispatch-outbound.ts`, 0086/0087 |
| R1–R6 follow-up/recontact + post-source allocate + Vendor send | `store.ts`, campaigns page, migrations |
| generateOutreachFor/Live foreign seatId | `store.ts:2003` / `:2066` (`b6c1063`) |

## Remaining tip gaps

| File:line | One-line fix | Conf |
|---|---|---|
| `src/lib/store.ts:5872` | Aria `draft` verb: call `allocateOutreach({ campaignId })` instead of `generateOutreachLive(cand.id)` (N>1 BC → 0 drafts today) | high |
| `src/lib/floor.ts:339` | When BC base is idle/"No campaign assigned", keep idle under ready+healthy+realSends — never upgrade to `sourcing` | high |
| `src/app/candidates/page.tsx:361` / `src/components/run/agent-run-stream.tsx:206` | Bulk/run draft paths: use `allocateOutreach({ campaignId })` (or attached seatId); same N>1 null hole as pre-R3 campaigns page | high |
| `src/lib/store.ts:3886` | `draftReplyResponse`: gate `latestOutreachSeatId` with `seatAttachedToCampaign` (prior/sole/fail-closed like R1) | high |
| `src/lib/store.ts:2219` / `:2303` | `draftFollowUpFor`/`draftRecontactFor`: refuse explicit `seatId` when `!seatAttachedToCampaign` (mirror `generateOutreach*`) | med |
| `src/app/api/fleet/computers/route.ts:355` | When POST `campaignId` set, 409 unless durable seat `assigned_campaign_ids` includes it (take/nav/release/ensure) | med |
| `src/app/api/outreach/confirm-manual/route.ts` + `store.ts` `confirmManualSend` | Apply Vendor/Assisted attach (`seatAttachedToCampaign`) before recording confirm | med |
| `tests/*` | No tests for Aria allocate draft, floor unattached idle→sourcing, reply-seat attach, fleet POST campaign attach | med |

## Notes

- Floor/cortex/Campaign Agents still correctly prefer/require explicit BC attach for narration and badges; gap is overlay theater at `floor.ts:339` feeding 3D `seatsToOfficeAgents` working status.
- Campaign Agents FE attach UI remains BC-only; Vendor empty=shared is intentional BE contract (`campaign-seat-attach.ts`).
- Production N-agent goal still blocked on owner Fly tip SHA + LI healthy (out of scope).
