# N-agent residual hunt — soft-nav / Floor / profiles / invent / mig / theater

**When:** 2026-10-03T16:22Z  
**Branch:** `cursor/fly-deploy-land-n-agent-b91d` @ `e0bd943` (N-agent tip still `81d3d8d` + relay)  
**Scope:** NEW tip gaps that would leave N agents unreal/invisible/unwired after Fly tip deploy.  
**Known closed (not re-reported):** sessionHealthy invent paths; Fleet Deploy omit campaignId; Take campaignId only when `seatAttachedToCampaign`; PacketFX/pulse/ticker attach-gated; liveSeats excludes LI BC; durable `[]` ≠ Hermes fallback; Attention/Settings ingest.

## Verdict: **NONE**

| Hunt class | Tip finding |
|---|---|
| 1 Soft-nav / campaign switch lose attach | Clears durable paint before poll (Agents / go-live / Setup / Agents badge); detach-all only when `campaignSeats` key present |
| 2 Floor 3D ignore durable campaignSeats | Unscoped GET emits `browserSeatBindings`; Floor `ingestDurableBrowserBindings` → stubs + patches; `seatsToOfficeAgents` maps full Hermes roster |
| 3 Shared Chromium profiles across campaigns | OpenBot `PROFILE_ROOT/<botId>`; botId from `toOpenBotBotId(computerId)`; 1 seat ↔ 1 computerId mint/ensure |
| 4 Invented healthy/session without probe | GET restores only `meta.healthy===true`; probe sets `data.healthy === true`; TTL expires stale true; API returns `rec.sessionHealthy ?? null` |
| 5 Missing 0085–0087 Fly apply path | Path present: bootstrap image `COPY supabase/migrations` + `deploy-fly.sh` step 7 `ARIA_BOOTSTRAP_PHASE=migrations` + `fly-n-agent-proof.sh` gates `0087`. Prod still on `0084` = owner dispatch not tip-code gap |
| 6 Greenwash theater tests | Behavioral suites (`campaign-go-live`, `computer-supervisor`, `floor-fleet-wire` activity) + drift nets; no invent-true API path left unguarded |

## Live Fly (unchanged blocker)

```
bash scripts/fly-n-agent-proof.sh 81d3d8d… → exit 1
build 21a42e7… ≠ tip; migration 0084; agentFrameworks false
```
