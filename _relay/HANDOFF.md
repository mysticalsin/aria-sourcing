---
project: MSourcing / ARIA
shift: 169
agent: cursor-cloud
updated: 2026-08-27T15:10Z
status: awaiting-microsoft-entra-and-deploy-confirm
---

# Handoff — Shift 169

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **PR #32**
- **Fly live:** `ba88302` / mig `0060` / Graph **404** / not_ready
- **Missing (6):** MICROSOFT_CLIENT_* + GOTRUE_EXTERNAL_AZURE_*
- **Azure device code:** https://login.microsoft.com/device → **BVD8K23XG** (Twalteur@amaris.com + Authenticator MFA)
- **MFA:** browser reached Authenticator number matching for Twalteur@amaris.com; owner phone approval still required
- **Background:** tmux `fly-wait-entra` runs `scripts/fly-wait-entra-and-golive.sh` (auto mint/apply/golive when az login or drop-zone appears; never invents confirm)
- **Preflight OK:** admin login + webhook HMAC; tip needs deploy for `jobQueued`/`requisition_parse`

## Done this shift

- `scripts/fly-wait-entra-and-golive.sh` long-poll Entra unlock → az-create --apply → golive-when-ready
- Prior hydrate UX, sync-fly-e2e-tmp-secrets, az-create, deploy-confirm drop-zone

## Next steps

1. Owner: MFA approve device code **BVD8K23XG** OR fill `/tmp/owner-microsoft.env`
2. `bash scripts/print-fly-deploy-confirm.sh` → `/tmp/owner-deploy-confirm.env` (never invent `ARIA_PROD_DEPLOY_CONFIRM`)
3. Waiter/golive deploys tip → Connect Outlook (live) + webhook
4. `eval "$(bash scripts/print-fly-e2e-env.sh --export)" && bash e2e-workflow-test.sh`
5. Goal complete: ready ok + mig>=0066 + tip build + Graph200 + E2E PASS

## Decisions made (don't relitigate)

- PR #32 supersedes #29–#31
- Never invent Azure secrets or deploy confirm
- Seat mode=live required for Teams book
- GoTrue admin password ≠ Entra password

## Watch out

- Device codes expire ~15 min (waiter refreshes)
- Never commit owner-*.env
