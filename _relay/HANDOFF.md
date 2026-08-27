---
project: MSourcing / ARIA
shift: 168
agent: cursor-cloud
updated: 2026-08-27T15:00Z
status: awaiting-microsoft-entra-and-deploy-confirm
---

# Handoff — Shift 168

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **PR #32** · tip includes hydrate + sync helper
- **Fly live:** `ba88302` / mig `0060` / Graph **404** / not_ready
- **Missing (6):** MICROSOFT_CLIENT_* + GOTRUE_EXTERNAL_AZURE_*
- **Azure CLI:** device-code — https://login.microsoft.com/device code **B2HR7KTSP** (MFA Authenticator required for Twalteur@amaris.com)
- **Preflight OK (non-Azure):** GoTrue admin login + role=admin; webhook HMAC 200 (stale image returns `classifyQueued`, tip expects `jobQueued`/`requisition_parse`); CRON/webhook synced via `scripts/sync-fly-e2e-tmp-secrets.sh`

## Done this shift

- Restored admin password path; verified `current_profile_role=admin`
- Confirmed webhook HMAC with `x-aria-signature` (hex, no `sha256=` prefix)
- Added `scripts/sync-fly-e2e-tmp-secrets.sh` for webhook/cron/service-role /tmp refresh
- Browser device login blocked on Authenticator number matching (owner phone)

## Next steps

1. Owner: approve MFA for device code **B2HR7KTSP** (or fill `/tmp/owner-microsoft.env`)
2. `bash scripts/print-fly-deploy-confirm.sh` → `/tmp/owner-deploy-confirm.env` (never invent `ARIA_PROD_DEPLOY_CONFIRM`)
3. `bash scripts/fly-enterprise-golive-when-ready.sh` (az login auto-runs `az-create-mantu-graph-app.sh`)
4. Connect Outlook (live) + webhook → `eval "$(bash scripts/print-fly-e2e-env.sh --export)" && bash e2e-workflow-test.sh`
5. Goal complete: ready ok + mig>=0066 + tip build + Graph200 + E2E PASS

## Decisions made (don't relitigate)

- PR #32 supersedes #29–#31
- Never invent Azure secrets or deploy confirm
- Seat mode=live required for Teams book
- GoTrue admin password ≠ Entra password

## Watch out

- Stale Fly returns `classifyQueued` until tip deploy
- Device codes expire ~15 min; MFA number matching needs phone
