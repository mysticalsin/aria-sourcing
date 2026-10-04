# N-agent tip gaps AFTER R1–R6 — closed on tip

**Tip under audit:** findings from hunt at `b6c1063`; closures through `b0c8662`+fleet POST attach.

## Closed

| Gap | Status |
|---|---|
| Aria `draft` → `allocateOutreach` | fixed |
| Floor unattached BC idle under ready+healthy+sends | fixed |
| Bulk/run drafts stamp attached BC (round-robin) | fixed |
| `draftReplyResponse` attach gate | fixed |
| follow-up/recontact refuse foreign seatId | fixed |
| confirm-manual Vendor/Assisted attach | fixed |
| Fleet POST campaignId → 409 unless durable attached | fixed (this commit) |

## Still out of scope

- Owner Fly tip redeploy (`21a42e7` / `0084` / `agentFrameworks:false`) + LI healthy
