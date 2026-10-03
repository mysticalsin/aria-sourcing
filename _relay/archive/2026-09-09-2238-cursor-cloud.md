---
project: MSourcing / ARIA
shift: 121
agent: cursor-cloud
updated: 2026-09-09T15:00Z
status: fly-view-interactive-fullscreen
---

# Handoff — Shift 121

## Current state

- **Branch:** `cursor/campaign-agent-vm-control-b91d`
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/76
- **Fly Chromium:** https://aria-mantu-computers.fly.dev — Take control is fullscreen + click/type/scroll wired
- **View URL:** https://aria-mantu-computers.fly.dev/view/comp_java_01?fs=1
- **Fly app tip:** redeploy pending with Campaign Agents fullscreen panel (this commit)

## Done this shift

1. Fixed OpenBot `/view` — keyboard forwarding, type box, accurate click mapping via naturalWidth/Height, scroll, fullscreen Take control
2. Redeployed `aria-mantu-computers` with interactive view
3. Campaign Agents Take control opens full sandbox tab + in-panel fullscreen when human
4. Proved click/type/key APIs + HUMAN+fs screenshot

## Blockers

1. Operator still must complete LinkedIn login/2FA once (credentials not in agent env)

## Next steps

1. Open https://aria-mantu-computers.fly.dev/view/comp_java_01?fs=1 → click email field → type → login
2. Release when done; re-run LinkedIn send proof

## Decisions made (don't relitigate)

- Production LinkedIn/OpenBot/campaign VMs = Fly only
- Screenshot remote desktop (not true VNC) — input via click-xy + keyboard APIs
- Never COMPUTER_SUPERVISOR_MOCK_SEND=1 on prod

## Watch out

- Do not commit computer/supervisor tokens embedded in view HTML (existing design)
