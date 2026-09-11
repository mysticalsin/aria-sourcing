---
project: MSourcing / ARIA
shift: 162
agent: cursor-cloud
updated: 2026-09-11T10:57Z
status: n-agent-floor-prove-on-fly
---

# Handoff — Shift 162

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` @ `963a337` (docs); **Fly code build** `820160e` (`820160ec6d152840af5c2d6534918419a6685e9b`)
- **Fly:** https://aria-mantu-app.fly.dev `/api/ready` build matches code commit · migration tip `0084_agent_seats_computer_id_unique.sql` (probe true)
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/115 → `integration/sourcing-enrichment-on-main` (draft)
- **Computers:** max 5 · https://aria-mantu-computers.fly.dev
- **Policy:** every improvement on Fly

## Done this shift

1. Floor drawer Meta **Browser Computer** prefers API-bound `boundComputerId`
2. `tests/floor.mts`: N=5 seats → N distinct `…last8` floor suffixes; computerId-only hints; no invented `sessionHealthy`
3. `scripts/prove-n-agent-floor.mts` offline + LIVE ensure/stop on Fly computers
4. Evidence `_relay/evidence/2026-09-11-n-agent-floor-proof.json` — 3 distinct live `comp_*` UUIDs, distinct floor suffixes, stopped after
5. Deployed Fly @ `820160e`; `ARIA_RELEASE_SHA` set; floor tests 37 passed

## Blockers (goal incomplete)

1. Human Take control + LinkedIn 2FA per seat
2. OPENBOT_MAX_COMPUTERS=5
3. `/api/ready` agentFrameworks:false (Deerflow/Flowise — not campaign VM path)
4. Operator UI prove Deploy→login→Release→floor shows distinct VM ids + session healthy

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
