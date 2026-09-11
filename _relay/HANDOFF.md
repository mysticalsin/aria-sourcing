---
project: MSourcing / ARIA
shift: 166
agent: cursor-cloud
updated: 2026-09-11T13:25Z
status: fleet-get-no-mint-unbound-honest
---

# Handoff — Shift 166

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` (commit after this shift push)
- **Fly:** https://aria-mantu-app.fly.dev · `/api/ready` build still `a5f4c73f15ac721079f67f107858d1c7fec6d4b0` until redeploy · migration tip `0084_agent_seats_computer_id_unique.sql`
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/119 → `integration/sourcing-enrichment-on-main` (draft)
- **Computers:** https://aria-mantu-computers.fly.dev · bot `comp_tony_01` · max 5
- **Tony reach-out E2E:** video recorded prior shift; LinkedIn `healthy:false` (login wall)

## Done this shift

1. **GET `/api/fleet/computers` no longer mints** — uses `hydrateComputer` only; unbound seats omitted from list
2. Ownership-mismatch on GET **clears poisoned FK** (no remint on read)
3. Campaign Agents panel: unbound seats show **No Browser Computer** and disable Start/Observe/Take control (no `"(unassigned)"` theater)
4. Tests: `computer-supervisor` 45/45 (hydrateComputer null/whitespace/durable); floor 40; typecheck green

## Blockers (goal incomplete)

1. Human Take control + LinkedIn 2FA on `comp_tony_01`
2. OPENBOT_MAX_COMPUTERS=5
3. `/api/ready` agentFrameworks:false (Deerflow/Flowise — not campaign VM path)
4. Operator UI prove Deploy→login→Release→floor distinct VM ids + session healthy
5. Redeploy Fly so GET no-mint ships to production

## Next steps

1. `flyctl deploy -a aria-mantu-app` (or CI) with this tip; set release SHA
2. Human login/2FA on `comp_tony_01`
3. Operator prove N seats on Floor with distinct `…last8` VM ids after Release
4. Re-run Tony reach-out recorder once session-probe healthy

## Decisions made (don't relitigate)

- Fly-only for LinkedIn / OpenBot / computers
- Never invent `sessionHealthy=true` without `/session-probe`
- Never invent `computerId` from `seat.id`
- Never mint ephemeral `computerId` on LinkedIn send path
- **Never mint on GET/list/poll** — only Deploy/Login/POST ensure
- Unique `(workspace_id, computer_id)` enforced in DB (0084)
- Host-full → refuse new Browser Computer seats
- Hero Login with N seats requires explicit seat row
- Mock send disabled on Fly unless explicitly allowed

## Watch out

- Demo-login rate limit ~5/min
- Do not commit `/tmp/aria-e2e/*` secrets
- Live prove stops bots unless `KEEP_LIVE=1`
- After deploy, confirm Floor/Settings/Campaign polls no longer create twin `comp_*` rows for unbound seats
