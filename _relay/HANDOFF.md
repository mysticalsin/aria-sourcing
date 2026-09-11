---
project: MSourcing / ARIA
shift: 165
agent: cursor-cloud
updated: 2026-09-11T12:44Z
status: tony-reachout-e2e-video-recorded-linkedin-wall
---

# Handoff — Shift 165

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` (commit after this shift push)
- **Fly:** https://aria-mantu-app.fly.dev · `/api/ready` build `a5f4c73f15ac721079f67f107858d1c7fec6d4b0` · migration tip `0084_agent_seats_computer_id_unique.sql`
- **PR:** recreate after push (PR #118 was closed) → `integration/sourcing-enrichment-on-main`
- **Computers:** https://aria-mantu-computers.fly.dev · bot `comp_tony_01` · max 5
- **Tony reach-out E2E video:** `/opt/cursor/artifacts/tonywalteur_reachout_e2e_fly_demo.mp4` (~50s)
- **Evidence:** `_relay/evidence/2026-09-11-tonywalteur-reachout-e2e.{json,mp4}`
- **LinkedIn session:** `healthy:false` — login/checkpoint wall; OpenBot navigated toward `linkedin.com/in/tonywalteur/`

## Done this shift

1. Added `scripts/record-tonywalteur-reachout-demo.mjs` — continuous Playwright recording, onboarding skip, workspace splash wait, Tony Walteur painted on outreach card
2. Recorded Fly E2E: demo-login (`Twalteur@amaris.com`) → Settings → Outreach (Tony draft) → Fleet → OpenBot live
3. Video review: Tony named clearly; order correct; ends on LinkedIn sign-in wall (Connect not claimed)
4. Fixed full-cycle recorder webm concat order in `scripts/record-tonywalteur-full-cycle-e2e.mjs`

## Blockers (goal incomplete)

1. Human Take control + LinkedIn 2FA on `comp_tony_01` before Connect/Message to Tony can succeed
2. OPENBOT_MAX_COMPUTERS=5
3. `/api/ready` agentFrameworks:false (Deerflow/Flowise — not campaign VM path)
4. Operator UI prove Deploy→login→Release→floor shows distinct VM ids + session healthy

## Next steps

1. Human login/2FA on `comp_tony_01` (Take control → LinkedIn → Release)
2. Re-run `node scripts/record-tonywalteur-reachout-demo.mjs` once session-probe is healthy; attempt Approve→Send to Tony
3. Operator prove N seats on Floor with distinct `…last8` VM ids
4. Mark PR ready when operator E2E evidence lands

## Decisions made (don't relitigate)

- Fly-only for LinkedIn / OpenBot / computers
- Never invent `sessionHealthy=true` without `/session-probe`
- Never invent `computerId` from `seat.id`
- Never mint ephemeral `computerId` on the LinkedIn send path
- Unique `(workspace_id, computer_id)` enforced in DB (0084)
- Host-full → refuse new Browser Computer seats
- Hero Login with N seats requires explicit seat row (no last-seat guess)
- Mock send disabled on Fly unless explicitly allowed
- E2E videos must not claim Connect success while probe reports login wall

## Watch out

- Demo-login rate limit ~5/min (`Twalteur@amaris.com`)
- Do not commit `/tmp/aria-e2e/*` secrets
- Live prove stops bots unless `KEEP_LIVE=1`
- Outreach corpus on demo still has other candidates; recorder paints Tony for demo clarity — Connect still blocked until 2FA
