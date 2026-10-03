---
project: MSourcing / ARIA
shift: 237
agent: cursor-cloud
updated: 2026-10-03T01:56Z
status: reclaim-ensure-before-probe-gap-open-fly-stale
---

# Handoff — Shift 237

## Current state

- **Branch:** `cursor/linkedin-human-claude-chrome-b91d` @ tip (post-236 Hermes clear)
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/148
- **N-agent local:** Hermes orphan/absent clear + durable null clear landed (`580d0c3`)
- **Next tip gap (open):** `reclaimHealthyOrphan` `ensureComputer`s orphan id before healthy probe (`computer-supervisor.ts:681`)
- **Fly live:** build `21a42e7…`, `agentFrameworks:false`

## Done this shift

1. Audited preferred honesty sites (HUD, Deploy Hermes race, pulse/warming, mock send, ensureComputer reclaim)
2. Marked Hermes orphan-clear finding fixed (`580d0c3`); residual BE race logged as new open finding
3. Skipped already-done items (supervisor TTL, campaignSeats, floor honesty, Hermes poll clear, booking trail, Jina)

## Blockers

1. No Fly deploy token
2. Operator Take→login→Release after tip deploy

## Next steps

1. Fix `reclaimHealthyOrphan`: probe orphan `currentId` before `claimOrphan`; honor `priorSeatId`; leave unhealthy as orphan
2. Add `tests/computer-supervisor.mts` case: Deploy-style reclaim with orphan twin + null health must not seat-bind; foreign priorSeatId via existingComputerId refused
3. Optional FE belt: Deploy omit `existingComputerId` when fleet shows orphan/absent for that id
4. Owner Fly redeploy tip + `ARIA_JINA_API_KEY`; prove sessionHealthy (never invent)

## Decisions (don't relitigate)

- Never invent sessionHealthy=true
- Hermes must not keep login-wall computerId when fleet only has __orphan__ / absent
- Empty fleet poll does not mass-clear Hermes (ambiguous)
- Floor 2D/3D/rollup share overlay truth
- Probe-before-claim for orphans (other-orphan loop already correct; currentId path must match)
- Pulse→working on ready+healthy is FX-only; rollup stays non-pulse (secondary)

## Watch out

- Do not mark N-agent goal complete until Fly tip SHA + LI healthy verified
- `ensureComputer` orphan claim (line 285) still has no priorSeatId gate — reclaim must not call it until healthy+allowed
