---
project: MSourcing / ARIA
shift: 162
agent: cursor-cloud
updated: 2026-09-11T10:53Z
status: n-agent-floor-prove-live
---

# Handoff — Shift 162

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` (commit pending deploy this shift)
- **Fly:** https://aria-mantu-app.fly.dev · computers https://aria-mantu-computers.fly.dev · max **5**
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/114 → `integration/sourcing-enrichment-on-main` (draft)
- **Policy:** every improvement on Fly

## Done this shift

1. Floor drawer Meta **Browser Computer** prefers API-bound `boundComputerId` (not seat-only id)
2. `tests/floor.mts`: N=5 LinkedIn Browser Computer seats → N distinct `…last8` floor suffixes; hints by `computerId` alone; never invents `sessionHealthy` working
3. `scripts/prove-n-agent-floor.mts`: offline + LIVE ensure/stop on Fly computers host
4. Live evidence `_relay/evidence/2026-09-11-n-agent-floor-proof.json` — 3 distinct `comp_*` UUIDs ensured, distinct floor suffixes, stopped after; `sessionHealthy` stays null without probe
5. Floor tests: 37 passed

## Blockers (goal incomplete)

1. Human Take control + LinkedIn 2FA per seat (`sessionHealthy` still human-gated)
2. OPENBOT_MAX_COMPUTERS=5 — raise/shard needed for 16 concurrent
3. `/api/ready` agentFrameworks:false (Deerflow/Flowise — not campaign VM path)
4. Operator UI prove: Deploy → login → Release → floor/drawer/campaign show distinct `comp_*` + session healthy

## Next steps

1. Operator login/2FA ≤5 seats; confirm floor + Settings show distinct VM ids + healthy after Release
2. Plan host raise/shard for 16 concurrent VMs when needed
3. Mark PR ready when operator E2E evidence lands

## Decisions made (don't relitigate)

- Fly-only for LinkedIn / OpenBot / computers
- Never invent `sessionHealthy=true` without `/session-probe`
- Never invent `computerId` from `seat.id`
- Unique `(workspace_id, computer_id)` enforced in DB (0084)
- Host-full → refuse new Browser Computer seats (Settings + campaign attach)

## Watch out

- Mock send still allows send without probe — production must not set it
- Live prove stops bots unless `KEEP_LIVE=1`
- `fly secrets set` rolls machines; verify `/api/ready` after
