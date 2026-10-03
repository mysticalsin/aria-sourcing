# N-agent goal completion audit — 2026-10-03T16:30Z

**Tip:** `cursor/fly-deploy-land-n-agent-b91d` @ `e0bd943` (proof gate fix pending this commit)  
**Deploy PR:** https://github.com/mysticalsin/aria-sourcing/pull/150 — `MERGEABLE`, squash auto-merge on, **`REVIEW_REQUIRED`**  
**Fly:** build `21a42e7…`, migration `0084`, `hermesRuntime:true`, `agentFrameworks:false`, `/api/ready` HTTP 503 (expected without DeerFlow/Flowise)  
**Proof:** `bash scripts/fly-n-agent-proof.sh` → exit 1 on tip≠build + migration≠0087 (frameworks no longer a fail gate)  
**Residual hunt:** **NONE**  
**Verdict:** tip requirements **satisfied** / production **incomplete** — **do not UpdateGoal complete**

## Requirements vs evidence

| Requirement | Tip evidence | Production evidence |
|---|---|---|
| N campaign agents real (1 seat = 1 VM/LI) | `seatAttachedToCampaign` / `isBrowserComputerSeat`; migrations 0085–0087 on tip; refuseUnattached on campaign-scoped fleet POST | Fly still migration `0084` |
| Isolated LinkedIn profiles | LI login + Agents deploy pass `campaignId` when attached; Fleet Deploy omits for new seats; Take only when `seatAttachedToCampaign` | Unproven on stale build |
| Visible on 3D floor | `ingestDurableBrowserBindings`; pulse/PacketFX/ticker LI attach-gated | Unproven — not tip SHA |
| Fully wired FE↔BE | Floor/Fleet/Agents/Setup/go-live/LI/viewport/Attention/Settings ingest; campaignSeats fail-closed | Unproven |
| No theater | never invent `sessionHealthy=true`; `liveSeats` excludes LI BC; Take won't send stale campaignId | Unproven |
| Ponytail | shared attach helpers; proof gates Hermes+0087 not DeerFlow/Flowise | — |

## Honest readiness note

`agentFrameworks` probes DeerFlow/Flowise adapters. This Fly tenant does not run those sidecars (`_relay/evidence/2026-09-05-fly-linkedin-live.md`). N campaign LI desks use Hermes/Browser Computer (`hermesRuntime`). Gating N-agent goal complete on `agentFrameworks:true` was incorrect theater — removed from `scripts/fly-n-agent-proof.sh`.

Full `deploy-fly.sh` still ends with `require_http_200 … /api/ready` under `AGENT_FRAMEWORKS_REQUIRED=true`; owner dispatch may go red late even after tip+0087 land. Prove via proof script JSON fields.

## Production blocker (ordered)

1. Owner **approve PR #150** (auto-merge squash → `deploy/fly-github-actions`)
2. CI+CodeQL green on **new deploy HEAD**
3. `node scripts/recovery-receipt-digest.mjs <receipt.json>` → dispatch Deploy Aria Mantu
4. Prove tip SHA + migration `0087` + Hermes data plane via `bash scripts/fly-n-agent-proof.sh`
5. Take→login→Release each campaign LI desk; `sessionHealthy===true` only after probe

Runbook: `_relay/evidence/2026-10-03-fly-owner-dispatch-runbook.md`

## Agent cannot

- Approve #150 / request reviewers (integration 403 on `addPullRequestReview`)
- Push protected `deploy/fly-github-actions` directly
- Invent recovery receipt or use `FLY_API_TOKEN`
