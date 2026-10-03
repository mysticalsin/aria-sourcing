# N-agent tip residual — floor durable bindings (post-4c4a53a)

## Fixed

| Gap | Fix |
|---|---|
| Floor Hermes-only attach (labels/FX) | GET `/api/fleet/computers` emits `browserSeatBindings` from `agent_seats`; Floor syncs Hermes |
| LI pulse without campaign attach | Pulse + 3D walk require `seatAttachedToCampaign` / non-empty assign |
| Unknown LI fleet status → theatrical base | `agentActivityWithComputers` fail-closed idle |
| `campaignBrowserSeatIds` provider string | `isBrowserComputerSeat` |

## Still out of scope

- Fly `21a42e7` / `0084` / `agentFrameworks:false` + LI Take→login→Release
- Durable-only seats missing from Hermes store (no local row) — still needs workspace rehydrate
