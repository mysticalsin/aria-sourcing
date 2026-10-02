# N-agent goal evidence audit — 2026-10-02

Objective: N campaign agents (isolated VMs/LinkedIn profiles) are real, visible on the 3D floor, fully wired FE↔BE, no theater.

| Requirement | Evidence | Verdict |
|---|---|---|
| N isolated Chromium VMs | Local OpenBot `:18765`; N=3 profile dirs; `prove-supervisor-floor-live`, `prove-n-agent-floor` LIVE | **Met (local)** |
| Distinct VM identity on floor | 2D desks + 3D copy show `N with live VM` + suffixes; Playwright screenshots | **Met (local)** |
| Visible on **3D** floor | `prove-floor-3d-ui`: canvas + `3 seats · 3 with live VM`; poll source lists N VMs | **Met (local)** |
| FE↔BE wire | Next `/api/fleet/computers` ensure/start → GET → floor poll; `prove-fleet-api-floor` | **Met (local)** |
| Never invent `sessionHealthy=true` | All proves keep null/unverified; TTL expire; Manual BE gate | **Met** |
| Campaign Agents FE | Panel polls same fleet API; badge `N/M with VM`; full `computerId` shown | **Met (code+API)** |
| Production Fly tip | Live `/api/ready` still old build `21a42e7`, `agentFrameworks:false` (`_relay/evidence/2026-10-02-fly-tip-still-stale.json` @ tip `90585ba`) | **Not met** |
| LinkedIn logged-in profiles (`sessionHealthy:true`) | Requires human Take control → login/2FA → Release | **Not met** |
| Agent Reach eyes (Jina) | PRD + `agent-reach-linkedin` adapter `via: agent-reach-jina`; OpenBot remains hands | **Met (code)** — MCP + interest→booking slices deferred |

## Conclusion

Local end-to-end path (OpenBot ↔ Fleet API ↔ Floor 2D/3D) is proven for N=3 isolated VMs with honest unverified LinkedIn state. Agent Reach slice 1 (public LinkedIn read via Jina) is in tip. **Goal remains open** until production Fly runs this tip and operators complete LinkedIn login on N seats (fresh probe within TTL).
