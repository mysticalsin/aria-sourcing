---
project: MSourcing / ARIA
shift: 150
agent: cursor-cloud
updated: 2026-08-27 UTC
status: awaiting-microsoft-entra-and-deploy-confirm
---

# Handoff — Shift 150

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#31** open (supersedes closed #29, #30)
- **Tip:** `d2764bb` (Kimi-first E2E defaults + M365 calendar-scope honesty)
- **Local gate:** `npx tsc --noEmit && npm test` green; audit matrix **45/45**
- **Fly auth:** `.fly-token.env`
- **Live present:** `ARIA_LOOP_KILL_SWITCH=false`, `KIMI_API_KEY`, `CRON_SECRET`, `EMAIL_INBOUND_WEBHOOK_SECRET` (value only in agent VM `/tmp/aria-e2e-webhook-secret`)
- **Live missing (7):** MICROSOFT_CLIENT_ID/SECRET/REDIRECT_URI + GOTRUE_EXTERNAL_AZURE_*
- **Stale image:** `ba88302` / mig **0060** / Graph validationToken **404** / `/api/ready` not_ready
- **Confirm:** unset — `bash scripts/print-fly-deploy-confirm.sh`
- **Agent shell:** ADMIN_* unset; webhook file present under `/tmp`

## Done this shift

- Rechecked Fly: still blocked on Microsoft/Entra + deploy confirm (no invent/bypass)
- `e2e-workflow-test.sh`: default `AGENT_PROVIDER=kimi` on Fly production URL (matches live `KIMI_API_KEY`)
- `print-fly-e2e-env.sh` / secrets checklist: document Kimi hermes exports
- M365 setup UI: calendar scope label matches OAuth (`Calendars.ReadWrite`, not fake OnlineMeetings scope)
- Audit matrix title 0065→0066; asserts `AGENT_PROVIDER=kimi` in E2E env printer
- Requested owner setup actions (Microsoft, Entra, ADMIN_*, deploy+Outlook)

## Next steps

1. Owner: set MICROSOFT_* on `aria-mantu-app` + GOTRUE_EXTERNAL_AZURE_* on `aria-mantu-auth`
2. Owner: `bash scripts/print-fly-deploy-confirm.sh` → export → `bash scripts/fly-deploy-now.sh`
3. Owner: Connect Outlook + Enable webhook; provide ADMIN_* (+ webhook secret if rotated)
4. Agent: `eval` print-fly-e2e-env + `bash e2e-workflow-test.sh` → ready+0066+Graph200+E2E PASS → goal complete

## Decisions made (don't relitigate)

- PR #31 supersedes closed #29 and #30
- No Fly deploy without `ARIA_PROD_DEPLOY_CONFIRM` — use `bash scripts/print-fly-deploy-confirm.sh`
- Target mig **0066**; `.fly-token.env` for flyctl
- Agent may set non-Azure operational secrets it owns (HMAC webhook, kill-switch); never invent Azure app credentials
- Never commit secret values to git / `_relay`
- Fly E2E hermes drafts default to **kimi** when `AGENT_PROVIDER` unset (matches Kimi-first Fly secrets)
- Calendar OAuth scope is `Calendars.ReadWrite` only; Teams joinUrl proven via live `confirmLive` book

## Watch out

- Fly cannot re-read secret values after set — rotate webhook if agent VM `/tmp` is lost
- Skip Actions billing CI failures; local gate is authority
- Timer `enterprise-e2e-deploy-recheck` every ~10m — status-only until confirm + secrets
