# N-agent adversarial tip pass — four surfaces

**When:** 2026-10-03T17:16Z  
**Branch:** `cursor/fly-deploy-land-n-agent-b91d` @ `cb142f2`  
**Scope:** NEW tip bugs that would break after Fly tip land. Known closed skipped.

## Verdict: **NONE**

| Surface | Tip check |
|---|---|
| Floor 3D from durable alone | Unscoped GET filters LI `agent_seats` → `browserSeatBindings`; Floor `ingestDurableBrowserBindings` → `applyBrowserSeatBindingsToHermes` stubs; `seatsToOfficeAgents` + `preferBrowserComputerAgents` |
| sessionHealthy invent | `openBotSessionProbe` coerces `healthy === true`; restore only `meta.healthy===true`; TTL expire; API `?? null`; Login local true only after probe/reclaim |
| campaignId on new Deploy | Fleet `deployAgents(n)` + `resolveDurableComputerId`/`bootBrowserComputer` omit campaignId; Campaign Agents Deploy passes only for already-attached desks |
| Live poll ingest | Floor / Fleet / Agents / go-live / Setup / viewport / LI settings / health-strip / Attention / campaign badge all call `ingestDurableBrowserBindings` on GET poll |

## Out of scope

- Owner Fly tip land / #150 approve / live LI desks
