---
project: MSourcing / ARIA
shift: 167
agent: cursor-cloud
updated: 2026-08-27T14:45Z
status: awaiting-microsoft-entra-and-deploy-confirm
---

# Handoff — Shift 167

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **PR #32**
- **Local gate:** tsc + npm test + audit (must stay 45/45)
- **Fly live:** `ba88302` / mig `0060` / Graph **404** / not_ready
- **Missing (6):** MICROSOFT_CLIENT_* + GOTRUE_EXTERNAL_AZURE_*
- **Azure CLI:** device-code — https://login.microsoft.com/device code **EUHDZE3FN** (refresh if expired)

## Done this shift

- Hydrate Outlook/Teams/Gmail integration cards from `/api/email/connections` (no dual-truth mock cards)
- Prior: M365 UX honesty, az-create-mantu-graph-app, owner-microsoft + owner-deploy-confirm drop-zones

## Next steps

1. Owner: device login **EUHDZE3FN** or fill `/tmp/owner-microsoft.env`
2. Export confirm via `bash scripts/print-fly-deploy-confirm.sh` (or `/tmp/owner-deploy-confirm.env`) — never invent `ARIA_PROD_DEPLOY_CONFIRM`
3. `bash scripts/fly-enterprise-golive-when-ready.sh` (az login auto-runs `az-create-mantu-graph-app.sh`)
4. Connect Outlook (live) + webhook → `eval "$(bash scripts/print-fly-e2e-env.sh --export)" && bash e2e-workflow-test.sh`
5. Goal complete: ready ok + mig>=0066 + tip build + Graph200 + E2E PASS

## Decisions made (don't relitigate)

- PR #32 supersedes #29–#31
- Never invent Azure secrets or deploy confirm
- Seat mode=live required for Teams book
- Migration floor >=0066

## Watch out

- Never commit owner-*.env drop-zones
- Device codes expire ~15 min
