---
project: MSourcing / ARIA
shift: 147
agent: cursor-cloud
updated: 2026-09-11T03:05Z
status: honesty-ux-fly-deploy
---

# Handoff — Shift 147

## Current state

- **Branch:** `cursor/openbot-desktop-vm-b91d` @ `bf024ca`
- **Fly app:** https://aria-mantu-app.fly.dev (deploy of honesty UX in progress / pending verify)
- **Fly computers:** https://aria-mantu-computers.fly.dev — `max:5`, desktop VM
- **Policy:** LinkedIn / AriaBot / OpenBot = **Fly only**
- **Audit:** `_relay/full-app-e2e-audit.md` updated (P0/P1 honesty items marked done)

## Done this shift

1. Roadmap IntegrationCard: Configure disabled → Coming soon when `!real`
2. Settings notifications: “Preference only — not delivering yet”
3. Replies: “Queue draft reply” (no false send)
4. Fleet: live host capacity strip from OpenBot `/health`
5. Outreach: “Allocate on Fleet” CTA
6. `openBotHostHealth` + `hostCapacity` on GET `/api/fleet/computers`

## Blockers

1. Human Take control + LinkedIn 2FA per seat
2. `OPENBOT_MAX_COMPUTERS=5` — raise/shard for 16 concurrent VMs
3. `/api/ready` → `agentFrameworks: false`
4. Application test group: 7 pre-existing Apollo/GitHub live-provider fails (unrelated to this UX)

## Next steps

1. Verify Fly deploy: `curl -fsS https://aria-mantu-app.fly.dev/api/health`
2. Operator prove script in `_relay/full-app-e2e-audit.md` (Deploy ≤5 → Take control → Floor)
3. Campaign detail: Allocate CTA (Outreach done)
4. Applicants reject: don’t claim email send if status-only
5. Release → session health probe

## Decisions (don't relitigate)

- Fly-only for computers + LinkedIn automation
- N seats = N Chromium profiles; Recruiter via Take control
- Host VM cap must be surfaced honestly in Fleet UX
- Roadmap integrations stay Coming soon until `real: true`

## Watch out

- Never commit Fly tokens / demo passwords / `.fly-secrets.env`
- Do not point Vercel env at `COMPUTER_SUPERVISOR_*`
- PR #105 was CLOSED — open a fresh PR for this branch if needed
