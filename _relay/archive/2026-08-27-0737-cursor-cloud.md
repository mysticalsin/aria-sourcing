---
project: MSourcing / ARIA
shift: 126
agent: cursor-cloud
updated: 2026-08-27 UTC
status: code-complete-awaiting-owner-deploy
---

# Handoff — Shift 126

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#31** open (supersedes closed #29, #30)
- **Local gate:** green after tip push; audit includes meeting_url + subject + graph-stage wiring
- **Fly live:** build `ba88302`, migration **0060** — Graph webhook **404**; needs tip + **0066**
- **Owner blockers:** `ARIA_PROD_DEPLOY_CONFIRM` unset; M365/webhook/Entra secrets; admin E2E creds
- **Note:** `FLY_API_TOKEN` is available in agent env for read-only probes; deploy still requires confirm

## Done this shift

- Inbound ingest persists Subject via `buildInboundEmailText` for requisition_parse
- Migration **0066** `meeting_url` on calendar ledger; confirmLive replay returns Teams join URL
- Graph create re-fetches event when joinUrl omitted on create response
- Worker uses `nextJobKindAfterGraphStage` from shared `graph-stage-jobs.json`
- Sample launch/reply UX gated on `demoLoginEnabled`
- Activate/golive probe Graph validationToken; E2E requires migration `0066_*`

## Owner activation

```bash
bash scripts/fly-enterprise-activate.sh $(git rev-parse HEAD)
bash scripts/print-fly-deploy-confirm.sh
# export + bash scripts/fly-deploy-now.sh
# set EMAIL_INBOUND_WEBHOOK_SECRET + MICROSOFT_* + GOTRUE_EXTERNAL_AZURE_*
bash scripts/print-fly-e2e-env.sh
export ADMIN_EMAIL='…' ADMIN_PASSWORD='…' EMAIL_INBOUND_WEBHOOK_SECRET='…'
bash e2e-workflow-test.sh
```

## Decisions made (don't relitigate)

- PR #31 supersedes closed #29 and #30
- No Fly deploy without `ARIA_PROD_DEPLOY_CONFIRM`
- Use `bash scripts/print-fly-deploy-confirm.sh` for exact deploy one-liner
- Skip Actions billing failures; local gate is authority

## Watch out

- Target migration is now **0066** (not 0065)
- Live Graph route is 404 until tip deploy
