---
project: MSourcing / ARIA
shift: 151
agent: cursor-cloud
updated: 2026-09-11T04:45Z
status: live-deploy-boots-vms
---

# Handoff — Shift 151

## Current state

- **Branch:** `cursor/openbot-desktop-vm-b91d`
- **PR:** #109
- **Fly app:** https://aria-mantu-app.fly.dev (deploy this tip)
- **Fly computers:** max 5
- **Policy:** every improvement pushed to Fly

## Done this shift

1. Live Fleet **Deploy + boot VMs** (no longer demo-only); cap by host free slots
2. Add one / Campaign attach Browser Computer → `bootBrowserComputer` (ensure+start)
3. Persist `computerId` via seat PATCH + mint-on-GET write-back
4. Go-live: never invent `sessionHealthy` from ready+bot; checklist polls computers
5. Floor: pulse cannot force “working” on Browser Computer seats without ready VM
6. Release still runs `/session-probe` (prior shift)

## Blockers

1. Human Take control + LinkedIn 2FA per seat
2. `OPENBOT_MAX_COMPUTERS=5`
3. `/api/ready` agentFrameworks false

## Next steps

1. Operator: Deploy ≤5 → Take control → login → Release → floor healthy/unhealthy
2. Optional: hydrate supervisor from `openBotListComputers` after cold start
3. Raise/shard host if 16 concurrent VMs required

## Decisions (don't relitigate)

- Every improvement pushed to Fly before shift ends
- Never invent sessionHealthy=true without `/session-probe`
- N seats = N Chromium profiles; Recruiter via Take control
- Live Deploy must boot VMs (ensure ≠ start)
