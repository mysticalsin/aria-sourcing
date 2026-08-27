---
project: MSourcing / ARIA
shift: 156
agent: cursor-cloud
updated: 2026-08-27 UTC
status: awaiting-microsoft-entra-and-deploy-confirm
---

# Handoff — Shift 156

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#31** open (supersedes closed #29, #30)
- **Tip:** `beb0a65c9ec841f9c82ee9a293f290dc74b77770` (fly-apply-owner-microsoft-secrets)
- **Local gate:** green; audit **45/45**
- **Fly missing (6):** MICROSOFT_CLIENT_ID/SECRET + GOTRUE_EXTERNAL_AZURE_*
- **Stale:** `ba88302` / mig **0060** / Graph **404**; confirm unset; ADMIN_* unset
- **REDIRECT_URI:** present on Fly

## Done this shift

- Added `scripts/fly-apply-owner-microsoft-secrets.sh` — applies owner-exported Azure/Entra env to Fly; refuses PLACEHOLDER/empty (no invent)
- Wired into activate + secrets checklist

## Next steps

1. Owner: export real MICROSOFT_CLIENT_ID/SECRET (+ Entra GOTRUE_*) then `bash scripts/fly-apply-owner-microsoft-secrets.sh`
2. Owner: `print-fly-deploy-confirm.sh` → export → `fly-deploy-now.sh`
3. Connect Outlook; provide ADMIN_*
4. Agent: E2E → ready+0066+Graph200+PASS → goal complete

## Decisions made (don't relitigate)

- PR #31 supersedes closed #29 and #30
- No Fly deploy without `ARIA_PROD_DEPLOY_CONFIRM` — use `bash scripts/print-fly-deploy-confirm.sh`
- Target mig **0066**; `.fly-token.env` for flyctl
- Never invent Azure client id/secret; apply script only uses owner-exported env
- Top-10 approve; missing-mantu-brand; kimi E2E default; LinkedIn 409; confirmLive Teams

## Watch out

- Outlook seat required after tip deploy; rotate webhook if `/tmp` lost
- Timer `enterprise-e2e-deploy-recheck` ~10m
