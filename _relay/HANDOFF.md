---
project: MSourcing / ARIA
shift: 149
agent: cursor-cloud
updated: 2026-09-11T03:20Z
status: honesty-ux-on-fly
---

# Handoff — Shift 149

## Current state

- **Branch:** `cursor/openbot-desktop-vm-b91d` @ `90849bc`
- **PR:** #106
- **Fly app:** https://aria-mantu-app.fly.dev — deployed (health OK; `/api/ready` still `agentFrameworks: false`)
- **Fly computers:** https://aria-mantu-computers.fly.dev — max 5
- **Policy:** every improvement pushed to Fly

## Done this shift

1. Honesty UX: Coming soon / pref-only notifications / Queue draft reply / Fleet capacity / Allocate CTAs
2. Applicant reject: no false email claim
3. Campaign **Allocate on Fleet**
4. **Release** after `help_requested` leaves `sessionHealthy=null` (no invented healthy)
5. LinkedIn pacing no longer treats ready/busy as session proof
6. `computer-supervisor` tests: 23 pass

## Blockers

1. Human Take control + LinkedIn 2FA per seat
2. `OPENBOT_MAX_COMPUTERS=5`
3. `/api/ready` agentFrameworks false in prod

## Next steps

1. Wire real session probe on Release (navigate LinkedIn + classify)
2. Schedules runner or keep preference-only banner
3. Setup-guide completion from real probes
4. Operator prove script in `_relay/full-app-e2e-audit.md`

## Decisions (don't relitigate)

- Fly-only for computers + LinkedIn automation
- Host VM cap must be honest in Fleet UX
- Never invent sessionHealthy=true without a probe
