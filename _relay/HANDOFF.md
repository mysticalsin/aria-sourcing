---
project: MSourcing / ARIA
shift: 153
agent: cursor-cloud
updated: 2026-08-27 UTC
status: awaiting-microsoft-entra-and-deploy-confirm
---

# Handoff — Shift 153

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#31** open (supersedes closed #29, #30)
- **Tip:** pending (top-10 approve cap + Mantu brand gate)
- **Local gate:** `npx tsc --noEmit && npm test` green; audit **45/45**
- **Fly auth:** `.fly-token.env`
- **Live present:** `ARIA_LOOP_KILL_SWITCH=false`, `KIMI_API_KEY`, `CRON_SECRET`, `EMAIL_INBOUND_WEBHOOK_SECRET`, `MICROSOFT_REDIRECT_URI`
- **Live missing (6):** MICROSOFT_CLIENT_ID/SECRET + GOTRUE_EXTERNAL_AZURE_*
- **Stale image:** `ba88302` / mig **0060** / Graph **404** / ready not_ready
- **Confirm:** unset — `bash scripts/print-fly-deploy-confirm.sh`

## Done this shift

- Cap `/api/shortlist/approve` at `TOP_CANDIDATE_SHORTLIST_SIZE` (10)
- Compliance critic rejects drafts missing `\bMantu\b` (`missing-mantu-brand`)
- `generateOutreachLive` always uses `mantuOutreachVoice()` persona (seat signature only)
- Audit matrix pins both gates; outreach-quality tests cover unbranded fail

## Next steps

1. Owner: MICROSOFT_CLIENT_ID/SECRET + GOTRUE_EXTERNAL_AZURE_* 
2. Owner: `print-fly-deploy-confirm.sh` → `fly-deploy-now.sh`
3. Connect Outlook + Enable webhook; provide ADMIN_*
4. Agent: E2E kimi → ready+0066+Graph200+PASS → goal complete

## Decisions made (don't relitigate)

- PR #31 supersedes closed #29 and #30
- No Fly deploy without `ARIA_PROD_DEPLOY_CONFIRM`
- Target mig **0066**; `.fly-token.env` for flyctl
- Agent may set public REDIRECT_URI / webhook / kill-switch; never invent Azure client id/secret
- Never commit secret values to git / `_relay`
- Fly E2E hermes drafts default to **kimi**
- Human shortlist approve capped at top **10**
- Outreach quality fails closed without **Mantu** brand token
- Calendar OAuth `Calendars.ReadWrite`; Teams joinUrl via `confirmLive` only
- LinkedIn send stays 409 assisted-manual

## Watch out

- Full E2E needs Outlook connected after secrets+tip deploy
- Skip Actions billing CI; local gate is authority
- Timer `enterprise-e2e-deploy-recheck` ~10m
