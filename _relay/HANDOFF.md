---
project: MSourcing / ARIA
shift: 146
agent: cursor-cloud
updated: 2026-09-11T02:52Z
status: full-app-e2e-audit
---

# Handoff — Shift 146

## Current state

- **Branch:** `cursor/openbot-desktop-vm-b91d`
- **Fly app:** https://aria-mantu-app.fly.dev healthy (login-gated)
- **Fly computers:** https://aria-mantu-computers.fly.dev healthy — `max:5`, desktop VM
- **Policy:** LinkedIn / AriaBot / OpenBot production = **Fly only** (not Vercel)
- **Audits:** `_relay/full-app-e2e-audit.md` (full), `_relay/e2e-tangibility-audit.md` (fleet/floor)

## Done this shift

1. Full-app E2E audit across 27 nav routes + Settings tabs (P0–P2 backlog)
2. Deploy now ensure+start VMs and reports booted vs host-cap blocks
3. Computer actions fail closed on `status=error` (no false “You have control”)
4. LinkedIn Automatic Ready no longer treats HeyReach-only as fully ready
5. Research UA host → `aria-mantu-app.fly.dev` (not Vercel demo)

## Blockers

1. Human Take control + LinkedIn 2FA per seat
2. `OPENBOT_MAX_COMPUTERS=5` on Fly — raise/shard before 16 concurrent VMs
3. `/api/ready` reports `agentFrameworks: false`

## Next steps

1. Operator: run prove script at bottom of `_relay/full-app-e2e-audit.md` on Fly
2. Fly: raise `OPENBOT_MAX_COMPUTERS` (and RAM) if 16 concurrent desktops required
3. P1: allocate CTA on Outreach/Campaign; rename misleading Send-reply; disable roadmap Connect

## Decisions (don't relitigate)

- Fly-only for computers + LinkedIn automation
- N seats = N Chromium profiles; Recruiter via Take control
- Host VM cap must be surfaced honestly in Fleet UX

## Watch out

- Never commit Fly tokens / demo passwords
- Do not point Vercel env at `COMPUTER_SUPERVISOR_*`
