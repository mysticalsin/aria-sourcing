# N-agent requirement audit — 2026-10-03 (explore)

Source: [N-agent theater audit](bc-920ff322-cbd5-57e9-8a68-6d5273362cd5) on tip after Agent Reach slice 1 + Quality green.

| Requirement | Status | Evidence | Gap |
|---|---|---|---|
| N isolated VMs / LI profiles real | local-only | `_relay/evidence/2026-10-02-local-n-agent-supervisor-floor.json`; 1 seat→1 computerId→profile | Fly: computers:0, tip not deployed |
| Visible on 3D floor + Campaign Agents from fleet API | local-only | floor-3d + campaign-agents UI prove JSON; FE polls `/api/fleet/computers` | Not proven on Fly |
| FE↔BE seat ownership; never invent sessionHealthy=true | proven | `computer-supervisor.ts` release/GET fail-closed; panel counts only `=== true` | Tip deploy + operator login still missing |
| linkedin_send refuses when mockSend=false && sessionHealthy!==true | proven | `computer-supervisor.ts` gate + tests | — |
| Agent Reach Jina eyes (`agent-reach-jina`) | proven | `agent-reach-linkedin.ts` + linkedin-browser-agents wire + tests | Slice 2/3 deferred |

## Tip-owned next (not theater; product depth)

1. Shared durable computer/job authority for multi-instance Fly (`computer-supervisor.ts` Maps).
2. Agent Reach slice 2: optional MCP LinkedIn sidecar (fail-closed).
3. Slice 3: interest→booking propose + Aria-scoped tracking trail.

## Production blockers (unchanged)

- Fly: build `21a42e7…`, `agentFrameworks:false`, 0 VMs, no deploy token.
- LI: `sessionHealthy:true` only after tip deploy + Take→login→Release within TTL.
