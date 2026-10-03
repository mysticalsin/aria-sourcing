# N-agent requirement audit — 2026-10-03 (updated shift 228)

| Requirement | Status | Evidence | Gap |
|---|---|---|---|
| N isolated VMs / LI profiles real | local-only | `_relay/evidence/2026-10-02-local-n-agent-supervisor-floor.json`; 1 seat→1 computerId→profile | Fly: computers Unauthorized/0; tip not deployed |
| Visible on 3D floor + Campaign Agents from fleet API | local-only | floor-3d + campaign-agents UI prove JSON; FE polls `/api/fleet/computers` | Not proven on Fly |
| FE↔BE seat ownership; never invent sessionHealthy=true | proven | `computer-supervisor.ts` fail-closed; `globalThis` singleton; durable audit restore within TTL (`meta.healthy===true` only) | Tip deploy + operator login still missing |
| linkedin_send refuses when mockSend=false && sessionHealthy!==true | proven | `computer-supervisor.ts` gate + tests | — |
| Agent Reach eyes + interest→booking trail | proven | slices 1–3.5 (Jina, MCP, booking_propose activity, durable `booking.proposed` on classify) | Slice 4 Fly+LI |

## Tip-owned next

1. ~~Process-local supervisor singleton (`globalThis`)~~ ✅
2. ~~Durable session health restore from `computer_audits` within TTL~~ ✅
3. Owner Fly tip deploy → `/api/ready` tip SHA + `agentFrameworks:true`
4. Operator Take→login→Release → live `sessionHealthy:true` within TTL

## Production blockers (unchanged)

- Fly: build `21a42e7…`, `agentFrameworks:false`, no deploy token.
- LI: `sessionHealthy:true` only after tip deploy + Take→login→Release within TTL.
