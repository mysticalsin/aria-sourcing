---
project: MSourcing / ARIA
shift: 161
agent: cursor-cloud
updated: 2026-09-11T10:11Z
status: migration-0084-on-fly-settings-honest
---

# Handoff — Shift 161

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` @ `758784c` (`758784ce587c7b835ddfd374406e2000013d4546`)
- **Fly:** https://aria-mantu-app.fly.dev `/api/ready` build matches tip · **migration tip `0084_agent_seats_computer_id_unique.sql` (probe true)**
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/114 → `integration/sourcing-enrichment-on-main` (draft)
- **Computers:** max 5 · https://aria-mantu-computers.fly.dev
- **Policy:** every improvement on Fly

## Done this shift

1. Applied prod migrations **0083** (Browser Computer inbound routes) + **0084** (unique `workspace_id, computer_id`) via DB SSH; ledger count 83
2. Updated `ARIA_EXPECTED_MIGRATION*` + `ARIA_EXPECTED_LEDGER_SHA` — `/api/ready` migration component **true**
3. Settings LinkedIn: overlay fleet `sessionHealthy` (no green badge without probe)
4. Settings / `ensure_connect` / campaign attach: refuse when Chromium host is full
5. Prior: N-seat `computerId` isolation (no `seat.id` invent), fail-closed send, floor VM labels
6. Tests: computer-supervisor 38, floor 31, campaign-go-live 11; typecheck green
7. Deployed Fly; ready build matches tip

## Blockers (goal incomplete)

1. Human Take control + LinkedIn 2FA per seat
2. OPENBOT_MAX_COMPUTERS=5
3. `/api/ready` agentFrameworks:false (Deerflow/Flowise — not campaign VM path)
4. Operator prove Deploy→login→Release→floor shows distinct VM ids + session healthy for N seats

## Next steps

1. Operator prove ≤5 seats with distinct `comp_*` ids + session healthy after login/Release
2. Plan host raise/shard for 16 concurrent VMs when operator needs it
3. Mark PR ready when E2E evidence lands

## Decisions made (don't relitigate)

- Fly-only for LinkedIn / OpenBot / computers
- Never invent `sessionHealthy=true` without `/session-probe`
- Never invent `computerId` from `seat.id`
- Unique `(workspace_id, computer_id)` enforced in DB (0084)
- Host-full → refuse new Browser Computer seats (Settings + campaign attach)

## Watch out

- Mock send still allows send without probe — production must not set it
- `fly secrets set` rolls machines; verify `/api/ready` after
- Bootstrap app still has no image; further migrations can use the same DB SSH path used for 0083/0084
