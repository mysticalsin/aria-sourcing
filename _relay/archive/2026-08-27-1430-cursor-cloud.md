---
project: MSourcing / ARIA
shift: 165
agent: cursor-cloud
updated: 2026-08-27T14:15Z
status: awaiting-microsoft-entra-and-deploy-confirm
---

# Handoff — Shift 165

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#32**
- **Fly live:** build `ba88302`, mig `0060`, Graph **404**, `/api/ready` not_ready
- **Missing (6):** MICROSOFT_CLIENT_* + GOTRUE_EXTERNAL_AZURE_*
- **Drop-zone / confirm:** absent / unset
- **Azure CLI:** device-code waiting — https://login.microsoft.com/device code **F7UVAKKSK**
- **Browser try:** Twalteur@amaris.com reached password/MFA; GoTrue `/tmp/aria-e2e-admin-password` ≠ Entra password (BLOCKED_BAD_PASSWORD). Authenticator MFA still required for Entra.

## Done this shift

- Added `scripts/az-create-mantu-graph-app.sh` — after `az login`, mints Entra app (Mail/Calendar + GoTrue redirects), writes `/tmp/owner-microsoft.env`, optional `--apply`
- `fly-enterprise-golive-when-ready.sh` auto-runs create when az is logged in
- Background watcher `owner-ms-watch` applies drop-zone / az-create when ready
- Local gate previously green (tsc/npm/audit 45/45)

## Next steps

1. Owner: https://login.microsoft.com/device → **F7UVAKKSK** (Entra account with app-registration rights + MFA) **or** fill `/tmp/owner-microsoft.env`
2. On az success: `bash scripts/az-create-mantu-graph-app.sh --apply` (or re-run golive)
3. Export confirm from `bash scripts/print-fly-deploy-confirm.sh` → `bash scripts/fly-enterprise-golive-when-ready.sh`
4. Tip deploy → Connect Outlook (live) + webhook → E2E PASS
5. Goal complete only: ready ok + mig>=0066 + tip build + Graph200 + E2E PASS

## Decisions made (don't relitigate)

- PR #32 supersedes #29–#31
- Never invent Azure secrets or deploy confirm
- Seat must be mode=live for Teams book
- Migration floor >=0066; tip has 0067

## Watch out

- App admin password ≠ Entra password; do not reuse GoTrue reset for device login
- Device codes expire ~15 min
- Never commit `/tmp/owner-microsoft.env`
