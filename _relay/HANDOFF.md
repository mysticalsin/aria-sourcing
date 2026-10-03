---
project: MSourcing / ARIA
shift: 245
agent: cursor-cloud
updated: 2026-10-03T02:40Z
status: jev-reader-best-uses-floor-hint-only-fly-stale
---

# Handoff — Shift 245

## Current state

- **Branch:** `cursor/linkedin-human-claude-chrome-b91d` @ `bee5237`
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/148
- **JEV:** `ARIA_JINA_API_KEY` portal `apikey_…` in `.env.local` — Reader prove 200 / 113k chars (`_relay/evidence/2026-10-03-jina-reader-auth-prove.json`). Best Aria uses = authenticated Reader enrichment; Search fail-closed until `jina_…` Bearer.
- **N-agent local:** Floor `withVm` hint-only (no Hermes suffix bleed); pulse no idle→working; viewport unboundOrphan gates stream/buttons
- **Fly live:** build `21a42e7…`, `agentFrameworks:false` (stale)

## Done this shift

1. JEV key confirmed for Reader best paths; status doctor exposes `keyKind` + `bestAriaUses`
2. Floor `withVm` = `hint?.computerId` only (no Hermes seat.computerId fallback)
3. Floor3D pulse skips idle/warming/error (no theatrical working)
4. Viewport orphan/empty seat: no Start/Take/stream until reclaim/bind
5. Tests: agent-reach-linkedin 24, floor 88, floor-fleet-wire 13

## Blockers

1. No Fly deploy token
2. Operator Take→login→Release after tip deploy
3. Owner: `ARIA_JINA_API_KEY` Fly secret (same portal key — Reader only)

## Next steps

1. Owner Fly redeploy tip until `/api/ready` build == tip SHA + agentFrameworks:true
2. Owner: `fly secrets set ARIA_JINA_API_KEY=…` on `aria-mantu-app`
3. Operator Take→login→Release; prove sessionHealthy within TTL
4. Confirm tip Quality green
5. Do not UpdateGoal complete until Fly tip SHA + LI healthy verified

## Decisions (don't relitigate)

- Never invent sessionHealthy=true
- Never index orphan/empty into Floor computerHints
- Bound VM suffix = fleet hint computerId only (not Hermes)
- Portal `apikey_…` → Reader (X-API-Key) best Aria use; Search needs `jina_…` Bearer
- Never commit ARIA_JINA_API_KEY
- Go-live attach accepts fleet bySeat with null Hermes

## Watch out

- Do not mark N-agent goal complete until Fly tip SHA + LI healthy verified
- Pulse must not force idle→working for FX
