---
project: MSourcing / ARIA
shift: 238
agent: cursor-cloud
updated: 2026-10-03T01:59Z
status: reclaim-probe-before-claim-shipped-fly-stale
---

# Handoff — Shift 238

## Current state

- **Branch:** `cursor/linkedin-human-claude-chrome-b91d` @ `c6ac494` (reclaim probe-before-claim)
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/148
- **N-agent local:** `reclaimHealthyOrphan` probes orphan/currentId before `claimOrphan`; Deploy omits staleTwin `existingComputerId`; tests 116/0
- **Jina (JEV):** portal `apikey_…` in `.env.local` only — Reader prove HTTP 200; Search stays Reader-only for this key kind
- **Fly live:** still build `21a42e7…`, `agentFrameworks:false` (owner redeploy)

## Done this shift

1. Rewrote `reclaimHealthyOrphan` probe-before-claim (orphan twin + foreign prior as currentId refuse)
2. Fallback never returns unhealthy `__orphan__` as seat-bound
3. Campaign Agents Deploy omits stale twin when fleet orphan/absent/foreign
4. Tests: unhealthy orphan twin, foreign prior as currentId, same-prior healthy twin claim
5. Jina Reader prove refreshed (`_relay/evidence/2026-10-03-jina-reader-auth-prove.json`); key never committed
6. Marked reclaim ensure-before-probe finding fixed (`c6ac494`)

## Blockers

1. No Fly deploy token
2. Operator Take→login→Release after tip deploy
3. Owner must set `ARIA_JINA_API_KEY` Fly secret for production Reader enrich

## Next steps

1. Owner Fly redeploy tip until `/api/ready` build == tip SHA + `agentFrameworks:true`
2. Owner: `fly secrets set ARIA_JINA_API_KEY=…` on `aria-mantu-app` (value from operator vault — not git)
3. Operator Take→login→Release; prove `sessionHealthy:true` within TTL on Floor + Campaign Agents
4. Confirm tip Quality green on latest tip HEAD
5. Do not UpdateGoal complete until Fly tip SHA + LI healthy verified

## Decisions (don't relitigate)

- Never invent sessionHealthy=true
- Hermes must not keep login-wall computerId when fleet only has __orphan__ / absent
- Empty fleet poll does not mass-clear Hermes (ambiguous)
- Floor 2D/3D/rollup share overlay truth
- Probe-before-claim for orphans (currentId path matches other-orphan loop)
- Portal `apikey_…` → X-API-Key Reader only; `jina_…` → Bearer Reader+Search
- Never commit ARIA_JINA_API_KEY

## Watch out

- `ensureComputer` orphan claim (line 285) still has no priorSeatId gate — reclaim must not call it until healthy+allowed (now satisfied for in-map orphans)
- Do not mark N-agent goal complete until Fly tip SHA + LI healthy verified
