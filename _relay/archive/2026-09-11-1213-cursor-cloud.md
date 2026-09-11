---
project: MSourcing / ARIA
shift: 163
agent: cursor-cloud
updated: 2026-09-11T11:42Z
status: n-agent-send-fail-closed-on-fly
---

# Handoff — Shift 163

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` @ `f855d00` (`f855d00c5c9a1894ae52b788fe33a35b0b662e48`)
- **Fly:** https://aria-mantu-app.fly.dev `/api/ready` build matches tip · migration tip `0084_agent_seats_computer_id_unique.sql` (probe true)
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/117 → `integration/sourcing-enrichment-on-main` (draft)
- **Computers:** max 5 · https://aria-mantu-computers.fly.dev
- **Policy:** every improvement on Fly

## Done this shift

1. Browser-computer send fails closed without durable `computerId` (channel + dispatch)
2. Floor starts with empty `computerHints` Map; poll failure keeps empty Map (no theatrical working)
3. Campaign attach: capacity + mint computerId **before** assign
4. Settings LinkedIn list shows `VM …last8` / `VM unassigned`
5. Tests: linkedin-channel-contract 23, floor 40, computer-supervisor 38; typecheck green
6. Deployed Fly; `ARIA_RELEASE_SHA` = tip; ready build matches

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
- Never mint ephemeral `computerId` on the LinkedIn send path
- Unique `(workspace_id, computer_id)` enforced in DB (0084)
- Host-full → refuse new Browser Computer seats (Settings + campaign attach)

## Watch out

- Mock send still allows send without probe — production must not set it
- Live prove stops bots unless `KEEP_LIVE=1`
- `fly secrets set` rolls machines; verify `/api/ready` after
