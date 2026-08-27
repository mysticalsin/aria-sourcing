---
project: MSourcing / ARIA
shift: 166
agent: cursor-cloud
updated: 2026-08-27T14:30Z
status: awaiting-microsoft-entra-and-deploy-confirm
---

# Handoff — Shift 166

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#32**
- **Local gate:** tsc OK · npm test EXIT 0 · audit **45/45**
- **Fly live:** `ba88302` / mig `0060` / Graph **404** / not_ready
- **Missing (6):** MICROSOFT_CLIENT_* + GOTRUE_EXTERNAL_AZURE_*
- **Azure CLI:** device-code — https://login.microsoft.com/device code **F7UVAKKSK** (refresh if expired)
- **Browser:** Twalteur Entra needs real Entra password/MFA (GoTrue admin password rejected)

## Done this shift

- UX honesty: M365 live-seat readiness item; Calendars.ReadWrite-only scope; calendar page copy; Outlook/Teams cards → Connect Outlook (no SMTP dry-run modal); Graph Teams Test probes live seat
- Ops: `/tmp/owner-deploy-confirm.env` drop-zone (example + gitignore); golive loads it; refuses PLACEHOLDER
- Prior: `az-create-mantu-graph-app.sh` + golive auto-mint after az login

## Next steps

1. Owner MFA/device login **F7UVAKKSK** → `az-create-mantu-graph-app.sh --apply` auto-runs
2. Or fill `/tmp/owner-microsoft.env` + `/tmp/owner-deploy-confirm.env` from print scripts
3. `bash scripts/fly-enterprise-golive-when-ready.sh` → tip deploy
4. Connect Outlook (live) + webhook → E2E PASS
5. Goal complete: ready ok + mig>=0066 + tip build + Graph200 + E2E PASS

## Decisions made (don't relitigate)

- PR #32 supersedes #29–#31
- Never invent Azure secrets or deploy confirm
- Seat mode=live required for Teams book
- Migration floor >=0066

## Watch out

- Never commit owner-*.env drop-zones
- Device codes expire ~15 min
