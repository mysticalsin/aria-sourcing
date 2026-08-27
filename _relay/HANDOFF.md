---
project: MSourcing / ARIA
shift: 164
agent: cursor-cloud
updated: 2026-08-27T14:10Z
status: awaiting-microsoft-entra-and-deploy-confirm
---

# Handoff — Shift 164

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#32** · tip `bfc42cb`
- **Local gate:** `npx tsc --noEmit` OK; `npm test` EXIT 0; audit matrix **45/45**
- **Fly live:** build `ba88302` (stale), mig `0060` (need >=0066), `/api/ready` not_ready, Graph validationToken **404**
- **Missing secrets (6):** `MICROSOFT_CLIENT_ID/SECRET` + `GOTRUE_EXTERNAL_AZURE_*` (4)
- **Drop-zone:** `/tmp/owner-microsoft.env` absent; `ARIA_PROD_DEPLOY_CONFIRM` unset
- **Azure CLI:** device-code waiting — https://login.microsoft.com/device code **FBBTWEZRE** (refresh if expired); ROPC Twalteur → AADSTS50126

## Done this shift

- Rechecked golive blockers; refreshed Azure device-code login
- Recorded owner setup actions (Azure secrets + device login/drop-zone + deploy confirm)
- Confirmed local tsc + npm test + audit 45/45 still green
- Timer `enterprise-e2e-deploy-recheck` still active (10 min)

## Next steps

1. Owner: device login with FBBTWEZRE **or** fill `/tmp/owner-microsoft.env` from `production-readiness/.owner-microsoft.env.example`
2. If az logged in → create Graph app (redirect `https://aria-mantu-app.fly.dev/auth/microsoft/callback`) → write drop-zone → `fly-apply-owner-microsoft-secrets.sh`
3. Export confirm from `bash scripts/print-fly-deploy-confirm.sh` → `bash scripts/fly-enterprise-golive-when-ready.sh`
4. After tip deploy: Connect Outlook (mode=live) + webhook → `eval "$(bash scripts/print-fly-e2e-env.sh --export)" && bash e2e-workflow-test.sh`
5. Goal complete only: ready ok + mig>=0066 + tip build + Graph200 + E2E PASS

## Decisions made (don't relitigate)

- PR #32 supersedes #29–#31
- Never invent Azure secrets or deploy confirm
- Seat must be mode=live for Teams book (not subscription alone)
- Migration floor >=0066; tip latest migration 0067

## Watch out

- Reconnect Outlook after tip deploy so existing mock seats become live
- Device codes expire ~15 min — restart `az login --use-device-code` if stale
- Do not commit `/tmp/owner-microsoft.env` or secret values into `_relay/`
