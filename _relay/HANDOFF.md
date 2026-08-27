---
project: MSourcing / ARIA
shift: 154
agent: cursor-cloud
updated: 2026-08-27 UTC
status: awaiting-microsoft-entra-and-deploy-confirm
---

# Handoff — Shift 154

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#31** open (supersedes closed #29, #30)
- **Tip:** pending (follow-up/recontact/regen Mantu voice + E2E webhook /tmp load)
- **Local gate:** `npx tsc --noEmit && npm test` green; audit **45/45**
- **Fly:** missing CLIENT_ID/SECRET + 4× Entra; REDIRECT_URI present; stale `ba88302` / mig **0060** / Graph **404**
- **Confirm:** unset; ADMIN_* unset; `/tmp/aria-e2e-webhook-secret` present

## Done this shift

- `enterpriseMantuVoice` for live + follow-up + recontact + regenerate (+ quality gate)
- `mock-ai` always uses Mantu persona (signature-only override)
- E2E auto-loads webhook secret from `/tmp/aria-e2e-webhook-secret` when env unset
- No Azure credentials on sibling Fly apps (hermes/bootstrap/kong)

## Next steps

1. Owner: MICROSOFT_CLIENT_ID/SECRET + GOTRUE_EXTERNAL_AZURE_*
2. Owner: `print-fly-deploy-confirm.sh` → `fly-deploy-now.sh`
3. Connect Outlook + Enable webhook; provide ADMIN_*
4. Agent: E2E (webhook auto from /tmp) → ready+0066+Graph200+PASS → goal complete

## Decisions made (don't relitigate)

- PR #31 supersedes closed #29/#30; no deploy without confirm; mig **0066**
- Never invent Azure client id/secret; public REDIRECT_URI OK for agent
- Top-10 approve cap; missing-mantu-brand compliance; kimi Fly E2E default
- LinkedIn 409; Teams joinUrl via confirmLive only

## Watch out

- Full E2E needs Outlook seat after tip deploy
- Rotate webhook if `/tmp` lost (Fly cannot re-read values)
- Timer `enterprise-e2e-deploy-recheck` ~10m
