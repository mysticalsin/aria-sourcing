---
project: MSourcing / ARIA
shift: 148
agent: cursor-cloud
updated: 2026-09-11T03:12Z
status: honesty-ux-on-fly
---

# Handoff — Shift 148

## Current state

- **Branch:** `cursor/openbot-desktop-vm-b91d` @ `5792a42`
- **PR:** #106 → `integration/sourcing-enrichment-on-main`
- **Fly app:** https://aria-mantu-app.fly.dev — redeploy of `5792a42` in progress
- **Fly computers:** https://aria-mantu-computers.fly.dev — `max:5`, desktop VM
- **Policy:** LinkedIn / AriaBot / OpenBot = **Fly only**
- **Audit:** `_relay/full-app-e2e-audit.md`

## Done this shift

1. Honesty UX on Fly (prior): Coming soon integrations, pref-only notifications, Queue draft reply, Fleet host capacity, Outreach Allocate CTA
2. Applicant reject: no false “sends email” claim
3. Campaign agents: **Allocate on Fleet** CTA + empty-state Fleet link
4. Staged `ARIA_RELEASE_SHA` secret update (applies on next deploy)

## Blockers

1. Human Take control + LinkedIn 2FA per seat
2. `OPENBOT_MAX_COMPUTERS=5` — raise/shard for 16 concurrent VMs
3. `/api/ready` → `agentFrameworks: false` (prod always requires frameworks today)

## Next steps

1. Finish Fly redeploy; verify `/api/health` + `/api/ready` `build` == `5792a42…`
2. Operator prove script in `_relay/full-app-e2e-audit.md`
3. Schedules honesty / setup-guide probes / Release → session health
4. Keep pushing every improvement to Fly (user standing order)

## Decisions (don't relitigate)

- Fly-only for computers + LinkedIn automation
- N seats = N Chromium profiles; Recruiter via Take control
- Host VM cap must be surfaced honestly in Fleet UX
- Roadmap integrations stay Coming soon until `real: true`

## Watch out

- Never commit Fly tokens / demo passwords
- Do not point Vercel env at `COMPUTER_SUPERVISOR_*`
- `ARIA_RELEASE_SHA` is a Fly **secret** (overrides `--env`); update secret when releasing
