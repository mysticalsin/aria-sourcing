---
project: MSourcing / ARIA
shift: 181
agent: cursor-cloud
updated: 2026-09-11T22:35Z
status: take-control-floor-honesty-tip-not-released
---

# Handoff — Shift 181

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` (takeControl clears sessionHealthy; floor honors `control=human`; sticky clears on idle; prefer-rank accepts base36 VM ids)
- **Fly:** https://aria-mantu-app.fly.dev — tip **not live**; `/api/ready` still old build / `ok:false`
- **Live fleet:** 1 computer, `sessionHealthy:false` (honest) until human LinkedIn login
- **PR:** recreate after push (prior #134 CLOSED)

## Done this shift

1. `takeControl` clears `sessionHealthy` (no stale green during human mutex)
2. `releaseControl` always invalidates healthy until probe; no-agent path stays null
3. `applyHostState` no longer yanks status while `control=human`
4. Floor/2D/3D treat `control=human` as idle "Operator in control" (even if healthy true)
5. Floor poll + pulse pass/respect `control`; pulse never theatrical under human
6. `preferBrowserComputerAgents` ranks `…[0-9a-zA-Z_-]{4,}` (base36 ids)
7. agentTick clears sticky on non-working; `DESK_STICKY_MS` 10s → 1.5s
8. Tests: floor 62, computer-supervisor 71; typecheck green; fleet-hermes-sync 8; linkedin-send-contract 8

## Blockers (goal incomplete)

1. Tip not on protected Fly release
2. Human Take control + LinkedIn login/2FA required (`sessionHealthy` still false)
3. OPENBOT_MAX_COMPUTERS=5; agentFrameworks:false
4. Operator N-seat prove of tip features outstanding on live

## Next steps

1. Human Take control → LinkedIn login/2FA → Release → session_probe healthy
2. Land tip via protected release — `/api/ready` build SHA == tip
3. Prove N distinct computerIds, no cross-desk bleed, floor only healthy/real-send (and never green under human control)
4. Mark PR ready only with tip live + healthy session + N-seat evidence

## Decisions (don't relitigate)

- Never invent `sessionHealthy=true` / LinkedIn delivered without probe + UI proof
- Invite notes ≤ **200**; Message/Invite both fail-closed on disabled Send / missing proof
- Orphan VMs must not green-badge or ops-drive other seats
- PATCH must not steal another seat's computerId
- Human `control` ⇒ floor idle (not working), even if a stale healthy lingered
- Fly-only LinkedIn / OpenBot / computers
- **Do not bypass protected Fly release guards**

## Watch out

- Demo-login `username` field; ~5/min; `Twalteur@amaris.com`
- Closing PRs often deletes remote branch
- Large mp4s stay in `/opt/cursor/artifacts/`
