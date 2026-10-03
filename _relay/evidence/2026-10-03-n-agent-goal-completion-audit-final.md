# N-agent goal completion audit — 2026-10-03T15:35Z

**Tip:** `cursor/fly-deploy-land-n-agent-b91d` @ `40338ce` (also mirrored on feature PR #148)  
**Deploy PR:** https://github.com/mysticalsin/aria-sourcing/pull/150 — `MERGEABLE`, squash auto-merge on, **`REVIEW_REQUIRED`**  
**Fly:** `https://aria-mantu-app.fly.dev/api/ready` → build `21a42e7…`, migration `0084`, `agentFrameworks:false`, status `not_ready`  
**Residual hunt:** **NONE**  
**Verdict:** tip requirements **satisfied** / production **incomplete** — **do not UpdateGoal complete**

## Requirements vs evidence

| Requirement | Tip evidence | Production evidence |
|---|---|---|
| N campaign agents real (1 seat = 1 VM/LI) | `seatAttachedToCampaign` / `isBrowserComputerSeat`; migrations 0085–0087 on tip; refuseUnattached on campaign-scoped fleet POST | Fly still migration `0084`; `agentFrameworks:false` |
| Isolated LinkedIn profiles | LI login + Agents deploy pass `campaignId` when attached; Fleet Deploy omits for new seats; Take only when `seatAttachedToCampaign` | Unproven on stale build |
| Visible on 3D floor | `ingestDurableBrowserBindings`; pulse/PacketFX/ticker LI attach-gated | Unproven — not tip SHA |
| Fully wired FE↔BE | Floor/Fleet/Agents/Setup/go-live/LI/viewport/Attention/Settings ingest; campaignSeats fail-closed | Unproven |
| No theater | never invent `sessionHealthy=true`; `liveSeats` excludes LI BC; Take won't send stale campaignId | Unproven |
| Ponytail | shared attach helpers + boot resolve campaignId optional | — |

## Tip closures this thread (post tip-closed)

- Viewport/Fleet Take: `campaignId` only if `seatAttachedToCampaign`
- `resolveDurableComputerId` optional `campaignId` when already attached
- Fleet Deploy omits `campaignId` for new seats (refuseUnattached false-fail fixed)
- Attention + Settings ingest durable bindings
- Drift tests in `tests/campaign-soft-nav-attach.mts`

## Production blocker (ordered)

1. Owner **approve PR #150** (auto-merge squash → `deploy/fly-github-actions`)
2. CI+CodeQL green on **new deploy HEAD**
3. `node scripts/recovery-receipt-digest.mjs <receipt.json>` → dispatch Deploy Aria Mantu
4. Prove `/api/ready` build==deploy tip && `agentFrameworks:true` && migration includes `0087`
5. Take→login→Release each campaign LI desk; `sessionHealthy===true` only after probe

Runbook: `_relay/evidence/2026-10-03-fly-owner-dispatch-runbook.md`

## Agent cannot

- Approve #150 / request reviewers (integration 403)
- Push protected `deploy/fly-github-actions`
- Invent recovery receipt or use `FLY_API_TOKEN`
