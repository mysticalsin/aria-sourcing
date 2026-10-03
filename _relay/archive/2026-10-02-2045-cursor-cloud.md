---
project: MSourcing / ARIA
shift: 204
agent: cursor-cloud
updated: 2026-10-02T20:35Z
status: n-agent-stale-health-ttl
---

# Handoff — Shift 204

## Current state

- **Branch:** `cursor/linkedin-human-claude-chrome-b91d`
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/148
- **Live Fly app:** build `21a42e7…`, `agentFrameworks:false` (tip not deployed)
- **Live computers host:** `ok`, `computers:0`, `max:5`, desktop/multitab true — needs token for LIVE prove
- **Goal:** N agents real + floor + FE↔BE — stale-green + mint twin theater closed; **live N healthy desks still unproven**

## Done this shift

1. `sessionProbedAt` + `SESSION_HEALTH_TTL_MS` (120s) — stale `sessionHealthy=true` expires to null on get/list/enqueue
2. Client mint via server `ensure` (no `crypto.randomUUID` twins)
3. Go-live `browser_seat_attached` requires durable `computerId`
4. Campaign Agents badge: `N/M with VM`; Floor copy: seats + live VM count
5. Suites: computer-supervisor 93, boot 14, go-live 14, floor-fleet-wire 9

## Blockers

1. No Fly/supervisor tokens in this cloud env — cannot LIVE=1 prove or redeploy
2. Operator Take control → LinkedIn login still required for real healthy sessions

## Next steps

1. Owner: deploy tip + provide COMPUTER_SUPERVISOR_TOKEN for LIVE prove
2. `LIVE=1 N=3 npx tsx scripts/prove-n-agent-floor.mts` against computers host
3. Per seat: Take → login → Release → floor paints working only when probe fresh within TTL

## Decisions (don't relitigate)

- Never invent `sessionHealthy=true`
- Stale process-local green expires (TTL) rather than durable shared store (ponytail)
- New computer ids mint server-side via ensure

## Watch out

- Tests that set `sessionHealthy=true` must also set fresh `sessionProbedAt`
- TTL is 120s — Floor poll at 5s will show unverified after expiry until next probe/Release
