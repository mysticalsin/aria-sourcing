---
project: MSourcing / ARIA
shift: 246
agent: cursor-cloud
updated: 2026-10-03T02:50Z
status: go-live-fleet-attach-floor-no-healthy-theater-fly-stale
---

# Handoff — Shift 246

## Current state

- **Branch:** `cursor/linkedin-human-claude-chrome-b91d` @ `4062b2e`
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/148
- **N-agent local:** Go-live attach requires fleet seat-owned bind when computers polled; Floor ready+healthy stays idle unless sentToday>0 or VM busy; LI unassigned = Standing by; BanRisk prefers fleet computerId; packet hub prefers healthy
- **Fly live:** build `21a42e7…`, `agentFrameworks:false` (stale)

## Done this shift

1. `evaluateCampaignGoLive` withComputer: fleet-polled → `computerForSeat` only (orphan Hermes twin cannot green attach)
2. Durable-only go-live stub: `mode:"mock"` + `domainVerified:false` (no invent live)
3. Floor ready+healthy → idle unless real sends; LI unassigned no foreign-campaign hash theater
4. BanRiskStrip `boundComputerIdBySeat`; Floor3D hub prefers session-healthy
5. Tests: floor 89, floor-fleet-wire 14, campaign-go-live 24

## Blockers

1. No Fly deploy token
2. Operator Take→login→Release after tip deploy
3. Owner: `ARIA_JINA_API_KEY` Fly secret

## Next steps

1. Owner Fly redeploy tip until `/api/ready` build == tip SHA + agentFrameworks:true
2. Owner set ARIA_JINA_API_KEY on Fly
3. Operator Take→login→Release; prove sessionHealthy within TTL
4. Confirm tip Quality green
5. Do not UpdateGoal complete until Fly tip SHA + LI healthy verified

## Decisions (don't relitigate)

- Never invent sessionHealthy=true
- Bound VM / go-live attach = fleet seat-owned when computers polled
- ready+healthy ≠ working (needs sends or status=busy)
- Portal apikey_… → Reader best Aria use
- Never commit ARIA_JINA_API_KEY

## Watch out

- Do not mark N-agent goal complete until Fly tip SHA + LI healthy verified
