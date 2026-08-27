---
project: MSourcing / ARIA
shift: 151
agent: cursor-cloud
updated: 2026-08-27 UTC
status: awaiting-microsoft-entra-and-deploy-confirm
---

# Handoff — Shift 151

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#31** open (supersedes closed #29, #30)
- **Tip:** pending commit (redirect-URI readiness + M365 honesty)
- **Local gate:** `npx tsc --noEmit && npm test` green; audit **45/45**
- **Fly auth:** `.fly-token.env`
- **Live present:** `ARIA_LOOP_KILL_SWITCH=false`, `KIMI_API_KEY`, `CRON_SECRET`, `EMAIL_INBOUND_WEBHOOK_SECRET`, **`MICROSOFT_REDIRECT_URI`** (public Fly callback; agent-set)
- **Live missing (6):** MICROSOFT_CLIENT_ID/SECRET + GOTRUE_EXTERNAL_AZURE_*
- **Stale image:** `ba88302` / mig **0060** / Graph **404** / ready not_ready (`agentFrameworks`)
- **Confirm:** unset — `bash scripts/print-fly-deploy-confirm.sh`
- **Agent shell:** ADMIN_* unset; webhook file under `/tmp/aria-e2e-webhook-secret`

## Done this shift

- `microsoftOAuth` now requires non-localhost `MICROSOFT_REDIRECT_URI` (prod https)
- Authorize/callback fail closed without usable redirect (no silent localhost in prod)
- Removed permanent `ok: false` Teams joinUrl checklist row; honesty in calendar subtitle + confirmLive copy
- Set Fly `MICROSOFT_REDIRECT_URI=https://aria-mantu-app.fly.dev/auth/microsoft/callback`

## Next steps

1. Owner: set MICROSOFT_CLIENT_ID/SECRET on app + GOTRUE_EXTERNAL_AZURE_* on auth
2. Owner: `print-fly-deploy-confirm.sh` → export → `fly-deploy-now.sh` (tip image + mig 0066 + AGENT_FRAMEWORKS_REQUIRED=false)
3. Connect Outlook + Enable webhook; provide ADMIN_* (+ webhook secret if rotated)
4. Agent: E2E with AGENT_PROVIDER=kimi → ready+0066+Graph200+PASS → goal complete

## Decisions made (don't relitigate)

- PR #31 supersedes closed #29 and #30
- No Fly deploy without `ARIA_PROD_DEPLOY_CONFIRM`
- Target mig **0066**; `.fly-token.env` for flyctl
- Agent may set non-Azure operational config it owns (HMAC webhook, kill-switch, **public REDIRECT_URI**); never invent Azure client id/secret
- Never commit secret values to git / `_relay`
- Fly E2E hermes drafts default to **kimi**
- Calendar OAuth scope is `Calendars.ReadWrite`; Teams joinUrl proven via live `confirmLive` only
- `microsoftOAuth` readiness requires `MICROSOFT_REDIRECT_URI` (prod https, not localhost)

## Watch out

- Fly cannot re-read secret values — rotate webhook if `/tmp` lost
- Skip Actions billing CI; local gate is authority
- Full E2E cannot PASS until Outlook is connected (mailbox route + Graph seat), even after secrets+tip deploy
- Timer `enterprise-e2e-deploy-recheck` ~10m
