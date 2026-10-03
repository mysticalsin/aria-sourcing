# N-agent goal completion audit — 2026-10-03T17:05Z

**Tip:** `cursor/fly-deploy-land-n-agent-b91d` @ `150b58a`  
**Deploy PR:** https://github.com/mysticalsin/aria-sourcing/pull/150 — `MERGEABLE`, squash auto-merge on, **`REVIEW_REQUIRED`**  
**Fly:** build `21a42e7…`, migration `0084`, `hermesRuntime:true`, `agentFrameworks:false`, `/api/ready` HTTP 503  
**Proof:** `bash scripts/fly-n-agent-proof.sh` → exit 1 (tip≠build, migration≠0087)  
**Tip residual:** **NONE**  
**Hermes deploy path:** **CLEAR** (ready JSON + degraded/empty heartbeat acceptance)  
**Verdict:** tip requirements **satisfied** / production **incomplete** — **do not UpdateGoal complete**

## Requirements vs evidence

| Requirement | Tip evidence | Production evidence |
|---|---|---|
| N campaign agents real (1 seat = 1 VM/LI) | attach gates; migrations 0085–0087; refuseUnattached | Fly still `0084` |
| Isolated LinkedIn profiles | campaignId only when attached; Fleet Deploy omits for new seats | Unproven on stale build |
| Visible on 3D floor | durable ingest; pulse/PacketFX/ticker attach-gated | Unproven |
| Fully wired FE↔BE | Floor/Fleet/Agents/Setup/go-live/LI/viewport/Attention/Settings | Unproven |
| No theater | never invent `sessionHealthy=true`; liveSeats excludes LI BC | Unproven |
| Ponytail | Hermes deploy gates; proof script; empty inventory honest degraded | — |

## Deploy path (Hermes-only tenant)

1. `require_app_ready_json` — tip SHA + Hermes plane; HTTP 503 with only `agentFrameworks:false` passes
2. Framework heartbeat — adapter/inventory `degraded` passes; empty inventory → `degraded`/`target_inventory_unavailable`; `worker_exception` fails
3. `bash scripts/fly-n-agent-proof.sh` after land — tip + `0087` + Hermes (not DeerFlow/Flowise)

## Production blocker (ordered)

1. Owner **approve PR #150** (non-pusher)
2. CI green on new `deploy/fly-github-actions` HEAD
3. Dispatch Deploy Aria Mantu + recovery receipt
4. Proof script green
5. Take→login→Release LI desks; `sessionHealthy` only after probe

Runbook: `_relay/evidence/2026-10-03-fly-owner-dispatch-runbook.md`
