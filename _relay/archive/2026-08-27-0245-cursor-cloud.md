---
project: MSourcing / ARIA
shift: 108
agent: cursor-cloud
updated: 2026-08-27 UTC
status: graph-webhook-wired-awaiting-fly-confirm
---

# Handoff — Shift 108

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#30**
- **Local gate:** `tsc` + `npm test` green; audit matrix **24/24**
- **CI Actions:** deferred per owner (billing) — do not block on empty runners
- **Fly live:** still migration **0060**; source now through **0064**; deploy needs `ARIA_PROD_DEPLOY_CONFIRM`

## Done this shift

- Microsoft Graph mail webhook: migration 0064, subscription create on Outlook connect, `/api/webhooks/microsoft-graph` (validationToken + clientState)
- Shared `ingestNormalizedInboundEmail` for HMAC + Graph adapters
- Autonomous parse/draft use server LLM (`serverGenerateText` / `parseInboundNeedLive`) with heuristic fallback
- Intake/Outlook UX: webhook-first; polling relabeled Emergency sync
- Golive target migration **0064**

## Blockers (owner — not Actions)

1. `ARIA_PROD_DEPLOY_CONFIRM` for Fly-only `fly-deploy-now.sh`
2. M365/webhook secrets on Fly if not set
3. Deployed E2E with admin creds

## Next steps

1. Owner provides deploy confirm → Fly push through 0064 only
2. Prove Graph webhook + E2E on aria-mantu-app.fly.dev
3. Resume CI only after billing restored (explicitly deferred)

## Decisions made (don't relitigate)

- Skip waiting on GitHub Actions billing; continue product/Fly path
- Fly-only enterprise production
- LinkedIn send assisted-manual (409)
