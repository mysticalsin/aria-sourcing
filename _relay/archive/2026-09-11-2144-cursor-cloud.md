---
project: MSourcing / ARIA
shift: 179
agent: cursor-cloud
updated: 2026-09-11T21:05Z
status: exec-e2e-video-li-notify-diagnosed-tip-not-released
---

# Handoff — Shift 179

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` (invite-note ≤200 + Sent/Pending proof + prior N-agent isolation)
- **Fly:** https://aria-mantu-app.fly.dev — build `8ea3370…` (**tip not live**); `/api/ready` `ok:false`
- **PR:** #132 → `integration/sourcing-enrichment-on-main` (draft; recreate if closed)
- **Durable bot:** `comp_7fe31958-…` — **LinkedIn session unhealthy** on live Floor (0 sends today)
- **Exec video:** `/opt/cursor/artifacts/aria-exec-recruiting-e2e-walkthrough.mp4` (~6.7 min)

## Done this shift

1. Diagnosed missing LinkedIn notification: primary = unhealthy LI Browser Computer / login wall (no delivery); secondary = invite vs Messaging surface; tertiary = note >200 chars greying Send; Message blocked for 3rd+ without InMail
2. Proof a prior Connect invite DID send (Sent today + Pending) — recipient must check **My Network → Invitations**
3. Tip fix: invite notes hard-cap **200** chars; refuse `ok` if Send disabled or Sent/Pending proof missing (`src/lib/openbot/linkedin-send.ts`)
4. Recorded live Fly executive walkthrough: Intake/Command → Campaign → JD → Strategy → Candidates scores → Outreach drafts → Agents → Floor → unhealthy LI computer
5. Evidence pack: `_relay/evidence/exec-recruiting-e2e/` (pngs + ROOT-CAUSE.md); mp4 kept in `/opt/cursor/artifacts/` (not committed)

## Blockers (goal incomplete)

1. Tip not on protected Fly release
2. Human Take control + LinkedIn login/2FA on durable VM required for live notifications
3. OPENBOT_MAX_COMPUTERS=5; `/api/ready` agentFrameworks:false
4. Operator N-seat prove of tip features still outstanding on live

## Next steps

1. Human Take control → LinkedIn login/2FA → Release → session_probe healthy
2. Re-send Connect with ≤200 note; prove Sent + Pending; tell recipient to check Invitations
3. Land tip via protected release
4. Mark PR ready only with tip SHA live + healthy session + N-seat evidence

## Decisions (don't relitigate)

- Never invent `sessionHealthy=true` / delivered LinkedIn without probe + UI proof
- Invite notes ≤ **200** chars (LinkedIn free tier)
- Fail closed if Send disabled or no Sent/Pending proof
- Fly-only LinkedIn / OpenBot / computers
- **Do not bypass protected Fly release guards**

## Watch out

- Demo-login uses `username` (not email); rate limit ~5/min; `Twalteur@amaris.com`
- Closing PRs often deletes remote branch
- Large mp4s stay under `/opt/cursor/artifacts/` — do not bloating-commit
