# N-agent residual hunt — adversarial tip pass (post shift 311)

**When:** 2026-10-03T16:55Z  
**Branch:** `cursor/fly-deploy-land-n-agent-b91d` @ `8cd6d76`  
**Scope:** NEW tip gaps that would leave N campaign agents unreal / invisible / unwired after Fly tip deploy (isolated VMs/LI profiles, 3D floor, FE↔BE, no theater).

**Known closed (not re-reported):** sessionHealthy invent; Fleet Deploy omit campaignId; Take campaignId only when attached; PacketFX/pulse/ticker attach-gated; liveSeats excludes LI BC; durable `[]` ≠ Hermes fallback; Attention/Settings ingest; ready JSON + heartbeat deploy gates for Hermes tenant.

## Verdict: **NONE**

| Hunt class | Tip finding |
|---|---|
| Soft-nav / campaign switch | Agents / go-live / Setup clear durable before poll; detach-all only when `campaignSeats` key present; Take scope gated by `seatAttachedToCampaign` |
| Floor 3D / durable ingest | Unscoped GET emits `browserSeatBindings`; Floor/Fleet/Agents/viewport/Attention/Settings/health-strip ingest; `seatsToOfficeAgents` + prefer-BC cap; orphan/empty owners skipped |
| 1 seat ↔ 1 Chromium / LI | `toOpenBotBotId(computerId)`; never seat.id as computerId; reclaim probe-before-claim; `isStaleHermesComputerTwin` on Deploy/Login/attach |
| sessionHealthy invent | GET restores only `meta.healthy===true`; probe sets true; TTL expires stale; API `rec.sessionHealthy ?? null`; local Login var only after probe/reclaim |
| FE↔BE attach / go-live | `campaignSeats` durable authority; merge fail-closed on `[]`; go-live requires seat-owned fleet bind + probed healthy |
| Deploy gates (post-311) | `require_app_ready_json` tip+Hermes; adapter-absent degraded heartbeat OK; `worker_exception` still fails — orthogonal to desk wiring |

## Live Fly (unchanged blocker)

```
build 21a42e7… ≠ tip; migration 0084; hermesRuntime true; /api/ready 503
bash scripts/fly-n-agent-proof.sh <tip> → exit 1 until owner lands #150 + dispatch
```
