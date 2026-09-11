---
project: MSourcing / ARIA
shift: 164
agent: cursor-cloud
updated: 2026-09-11T12:20Z
status: n-agent-seat-login-fleet-poll-fly-mock-refuse
---

# Handoff — Shift 164

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` (pending this commit)
- **Fly:** https://aria-mantu-app.fly.dev · computers https://aria-mantu-computers.fly.dev · max **5**
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/117 → `integration/sourcing-enrichment-on-main` (draft)
- **Policy:** every improvement on Fly

## Done this shift

1. Settings hero LinkedIn Login refuses when N>1 seats without `seatId` (per-row only)
2. `await updateSeat(computerId)` before ensure/start — no race-mint twins
3. GET `/api/fleet/computers` ownership mismatch: rebind by seatId + **await** persist (no fire-and-forget twin VMs)
4. Settings + Fleet poll computers every 5s (same truth as Floor)
5. Fly hard-refuses `COMPUTER_SUPERVISOR_MOCK_SEND` unless `ALLOW_COMPUTER_SUPERVISOR_MOCK_SEND=1`
6. Tests: computer-supervisor 39, floor 40, linkedin-channel-contract 23; typecheck green

## Blockers (goal incomplete)

1. Human Take control + LinkedIn 2FA per seat
2. OPENBOT_MAX_COMPUTERS=5
3. `/api/ready` agentFrameworks:false (Deerflow/Flowise — not campaign VM path)
4. Operator UI prove Deploy→login→Release→floor shows distinct VM ids + session healthy

## Next steps

1. Operator login/2FA ≤5 seats; confirm floor + Settings + Fleet show distinct VM ids + healthy after Release
2. Plan host raise/shard for 16 concurrent VMs when needed
3. Mark PR ready when operator E2E evidence lands

## Decisions made (don't relitigate)

- Fly-only for LinkedIn / OpenBot / computers
- Never invent `sessionHealthy=true` without `/session-probe`
- Never invent `computerId` from `seat.id`
- Never mint ephemeral `computerId` on the LinkedIn send path
- Unique `(workspace_id, computer_id)` enforced in DB (0084)
- Host-full → refuse new Browser Computer seats
- Hero Login with N seats requires explicit seat row (no last-seat guess)
- Mock send disabled on Fly unless explicitly allowed

## Watch out

- Live prove stops bots unless `KEEP_LIVE=1`
- `fly secrets set` rolls machines; verify `/api/ready` after
- Do not set `ALLOW_COMPUTER_SUPERVISOR_MOCK_SEND` on production Fly
