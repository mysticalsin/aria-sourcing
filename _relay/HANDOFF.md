---
project: MSourcing / ARIA
shift: 157
agent: cursor-cloud
updated: 2026-08-27 UTC
status: awaiting-microsoft-entra-and-deploy-confirm
---

# Handoff — Shift 157

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#31** open (supersedes closed #29, #30)
- **Tip:** `05d72ce79bd0e223d2354daa83d20c3ab797099e` (owner-microsoft.env drop-zone)
- **Local gate:** green; audit **45/45**
- **Fly missing (6):** MICROSOFT_CLIENT_ID/SECRET + GOTRUE_EXTERNAL_AZURE_*
- **Stale:** `ba88302` / mig **0060** / Graph **404**; confirm unset

## Done this shift

- Apply script loads `/tmp/owner-microsoft.env` or `production-readiness/.owner-microsoft.env` (gitignored)
- Example: `production-readiness/.owner-microsoft.env.example`
- Timer recheck looks for drop-zone before status-only

## Next steps

1. Owner: fill `/tmp/owner-microsoft.env` (from example) or export env → `bash scripts/fly-apply-owner-microsoft-secrets.sh`
2. `print-fly-deploy-confirm.sh` → `fly-deploy-now.sh`
3. Connect Outlook; provide ADMIN_*
4. Agent: E2E → ready+0066+Graph200+PASS → goal complete

## Decisions made (don't relitigate)

- PR #31 supersedes closed #29 and #30
- No Fly deploy without `ARIA_PROD_DEPLOY_CONFIRM`
- Never invent Azure client id/secret; apply refuses PLACEHOLDER
- Drop-zone files must never be committed

## Watch out

- Rotate webhook if `/tmp` lost; Outlook seat required after tip deploy
