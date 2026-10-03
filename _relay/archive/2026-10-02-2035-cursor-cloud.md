---
project: MSourcing / ARIA
shift: 203
agent: cursor-cloud
updated: 2026-10-02T20:15Z
status: n-agent-fe-be-wire-harden
---

# Handoff — Shift 203

## Current state

- **Branch:** `cursor/linkedin-human-claude-chrome-b91d`
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/148
- **Live Fly:** still `21a42e7…`, `/api/ready` → `not_ready`, `agentFrameworks: false` — tip not deployed
- **Goal:** N agents real + floor + FE↔BE — code wire hardened; **live N healthy desks not yet proven**

## Done this shift

1. Durable `fleet.browserAgentPermissionMode` (STATE_VERSION 24) — Manual BE-refuses `linkedin_send`
2. Options/viewport persist mode via Hermes settings (not localStorage-only theater)
3. Deleted unused `profileVolume`; README tells truth (`PROFILE_ROOT/<botId>`)
4. `ensure` persists `agent_seats.computer_id` (fail-closed)
5. `tests/floor-fleet-wire.mts` proves N agents from fleet API shape → floor (no invent healthy)
6. Suites: computer-supervisor 90, floor 65, floor-fleet-wire 9, browser-agent-permissions 18

## Blockers

1. Redeploy Fly tip + operator Take control → login → Release for real `sessionHealthy:true`
2. `agentFrameworks=false` / host capacity

## Next steps

1. Owner Fly app-only deploy of this tip
2. Deploy N Browser Computer seats; confirm floor shows N distinct `…xxxxxxxx` suffixes
3. Per seat: Take control → LinkedIn login → Release → probe healthy → green working only then

## Decisions (don't relitigate)

- Never invent `sessionHealthy=true`
- Manual permission mode is server-gated on linkedin_send
- Real Chromium isolate = OpenBot `PROFILE_ROOT/botId`, not profileVolume

## Watch out

- Host allowlist remains browser-local; mode is workspace-durable
- Tip ahead of live Fly build until redeploy
