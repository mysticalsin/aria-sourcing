---
project: MSourcing / ARIA
shift: 149
agent: cursor-cloud
updated: 2026-08-27 UTC
status: awaiting-microsoft-entra-and-deploy-confirm
---

# Handoff — Shift 149

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#31** open (supersedes closed #29, #30)
- **Tip:** `d947ee9`+ (missing-secrets script)
- **Fly auth:** `.fly-token.env`
- **Live present:** `ARIA_LOOP_KILL_SWITCH=false`, `KIMI_API_KEY`, **`EMAIL_INBOUND_WEBHOOK_SECRET`** (agent-generated on Fly this shift; value only in agent VM `/tmp/aria-e2e-webhook-secret`)
- **Live missing (7):** MICROSOFT_CLIENT_*, GOTRUE_EXTERNAL_AZURE_*
- **Stale image:** `ba88302` / mig **0060** / Graph **404**
- **Confirm:** unset — use `bash scripts/print-fly-deploy-confirm.sh`

## Next steps

1. Owner: set MICROSOFT_* on app + GOTRUE_EXTERNAL_AZURE_* on auth
2. Owner: `print-fly-deploy-confirm.sh` → export → `fly-deploy-now.sh`
3. Provide ADMIN_* (+ webhook secret if rotated) to agent → `e2e-workflow-test.sh`
4. Agent: ready+0066+Graph200+E2E PASS → goal complete

## Decisions made (don't relitigate)

- PR #31 supersedes closed #29 and #30
- No Fly deploy without `ARIA_PROD_DEPLOY_CONFIRM` — use `bash scripts/print-fly-deploy-confirm.sh`
- Target mig **0066**; `.fly-token.env` for flyctl
- Agent may set non-Azure operational secrets it owns (HMAC webhook, kill-switch); never invent Azure app credentials
- Never commit secret values to git / `_relay`

## Watch out

- Fly cannot re-read secret values after set — rotate webhook if agent VM `/tmp` is lost
