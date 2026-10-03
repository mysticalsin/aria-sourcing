---
project: MSourcing / ARIA
shift: 167
agent: cursor-cloud
updated: 2026-09-11T14:18Z
status: tony-invite-sent-session-persist-fix
---

# Handoff — Shift 167

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` (commit after this push)
- **Fly:** https://aria-mantu-app.fly.dev — redeploy this tip for session_probe + outreach layout fix
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/120 → `integration/sourcing-enrichment-on-main`
- **Durable LinkedIn bot:** `comp_7fe31958-589b-497f-8de7-c5083bf53ff5` (human-logged profile; cookies on computers volume)
- **Tony Walteur:** connection invite **sent today** with note (Pending on profile). Message/InMail blocked (3rd+ without Premium).
- **Session now:** LinkedIn remember-me auto-login interstitial (cookies present; may need one Take control click if hung)

## Done this shift

1. Found login lived on UUID bot, not `comp_tony_01` (remint/orphan identity leak)
2. Sent LinkedIn **Connect + note** to https://www.linkedin.com/in/tonywalteur/ via durable bot
3. Outreach Approvals: moved Fleet allocate banner **out of** `PageHeader` actions (broken layout/text)
4. Login path: reuse durable `computerId`; prefer healthy orphan before mint; `session_probe` opens `/feed` when healthy (no forced re-login after deploy)
5. Evidence: `_relay/evidence/2026-09-11-tonywalteur-connect-e2e.json`, artifacts `tonywalteur_invite_sent_proof.jpg`, `tonywalteur_profile_pending_proof.jpg`

## Blockers (goal incomplete)

1. Remember-me interstitial may need one human Take control if LinkedIn hangs
2. OPENBOT_MAX_COMPUTERS=5
3. `/api/ready` agentFrameworks:false
4. Operator prove Deploy→login→Release→floor distinct VMs + healthy
5. Seat DB row may still point at `comp_tony_01` — bind seat `computerId` to `comp_7fe31958-…` in Settings/Fleet after deploy

## Next steps

1. Deploy this tip to Fly; bind seat computerId → `comp_7fe31958-589b-497f-8de7-c5083bf53ff5`
2. If session interstitial hangs: Take control once on that bot, confirm feed, Release
3. Operator N-seat floor prove
4. Mark PR ready when operator E2E + stable session evidence lands

## Decisions made (don't relitigate)

- Fly-only for LinkedIn / OpenBot / computers
- Never invent `sessionHealthy=true` without `/session-probe`
- Never invent `computerId` from `seat.id`
- Never mint on GET/list/poll
- **Never remint a blank computerId when a durable/healthy profile already exists**
- Unique `(workspace_id, computer_id)` in DB (0084)
- Host-full → refuse new Browser Computer seats
- Mock send disabled on Fly unless explicitly allowed
- 3rd+ Message requires Premium — Connect+note is the honest free path

## Watch out

- Demo-login ~5/min
- Do not commit `/tmp/aria-e2e/*` secrets
- Personalized invite notes free-tier max **200 characters**
- `comp_tony_01` is a login-wall twin — do not send from it; use the UUID durable bot
