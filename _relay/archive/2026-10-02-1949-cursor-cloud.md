---
project: MSourcing / ARIA
shift: 201
agent: cursor-cloud
updated: 2026-09-12T09:48Z
status: n-agent-isolation-harden
---

# Handoff — Shift 201

## Current state

- **Branch:** `cursor/n-agent-isolation-harden-b91d` (from openbot-desktop-vm tip)
- **Goal:** N campaign agents real + floor-visible + FE↔BE wired (ponytail) — isolation harden landed; goal not complete until Fly proof of N distinct healthy seats
- **PR:** open/update for this branch → base `integration/sourcing-enrichment-on-main` (or openbot PR #143 stack)

## Done this shift

1. Fleet POST: `stop` / `reset` / `release_control` / `request_help` require caller `seatId` ownership match (same as start/take_control)
2. `priorSeatId` on detach; `reclaimHealthyOrphan` auto-claims only never-bound or same-prior orphans (no cookie steal)
3. FE always sends `seatId` on mutating computer actions (fleet page, viewport, campaign agents)
4. Floor: VM suffix when seat-keyed hint lacks `computerId` (N agents distinguishable); poison FK still fail-closed
5. Tests: `computer-supervisor` 87/87; `floor` 65/65

## Blockers

1. Human Take control on live Fly → LinkedIn CAPTCHA/login → Release → `sessionHealthy:true` still required for green floor
2. Host cap / `agentFrameworks=false` on `/api/ready`
3. Tip not on protected `deploy/fly-github-actions` without merge strategy

## Next steps

1. Push branch + open/update PR; run full `npm run typecheck && npm run typecheck:tests && npm test`
2. Redeploy Fly app-only with tip including isolation + fluid takeover
3. Prove floor shows N distinct computers with real status (no invented healthy)
4. Operator: Take control → LinkedIn login → Release → `sessionHealthy:true` per seat

## Decisions (don't relitigate)

- Never invent `sessionHealthy=true` / LinkedIn delivered without probe + UI proof
- Auto-reclaim must not steal another seat's detached LinkedIn profile (`priorSeatId` gate)
- Mutating computer actions always require caller seat ownership
- Do not bypass protected Fly release guards
- Fly only for LinkedIn / OpenBot / computers

## Watch out

- FE must keep sending `seatId` for stop/release or API returns 400
- Never-bound host orphans remain first-claimable (bootstrap) — only prior-bound orphans are seat-scoped
- Floor green = `ready && sessionHealthy === true` only
