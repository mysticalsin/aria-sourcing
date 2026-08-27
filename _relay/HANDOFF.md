---
project: MSourcing / ARIA
shift: 125
agent: cursor-cloud
updated: 2026-08-27 UTC
status: code-complete-awaiting-owner-deploy
---

# Handoff — Shift 125

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#31** open · tip after this commit
- **Local gate:** green; audit **36/36**; mantu E2E **30/30**
- **Fly live:** build `ba88302`, migration **0060** — Graph webhook route **404** (old build); needs tip + **0065**
- **Owner blockers:** `ARIA_PROD_DEPLOY_CONFIRM` unset; M365/webhook/Entra secrets; admin E2E creds

## Done this shift

- `e2e-workflow-test.sh` fail-closed on Fly without `EMAIL_INBOUND_WEBHOOK_SECRET` or migration `0065_*`
- Graph notification envelope probe (`unknown_subscription` → 202)
- Calendar dry-run uses Mantu first-interview agenda; asserts MIME branding wiring
- In-process E2E asserts `nextJobKindAfterGraphStage` + shared pipeline transitions

## Owner activation

```bash
bash scripts/fly-enterprise-activate.sh $(git rev-parse HEAD)
bash scripts/print-fly-deploy-confirm.sh
# export + bash scripts/fly-deploy-now.sh
# set Fly secrets including EMAIL_INBOUND_WEBHOOK_SECRET
bash scripts/print-fly-e2e-env.sh
export ADMIN_EMAIL='…' ADMIN_PASSWORD='…' EMAIL_INBOUND_WEBHOOK_SECRET='…'
bash e2e-workflow-test.sh
```

## Completion audit

Code/tests/PR #31: stronger live-proof harness. Live Fly E2E: still blocked on owner deploy.

## Decisions made (don't relitigate)

- PR #31 supersedes #29/#30
- No Fly deploy without `ARIA_PROD_DEPLOY_CONFIRM`
- Skip Actions billing failures; local gate is authority
- `ARIA_ALLOW_SKIP_WEBHOOK_E2E=1` / `ARIA_ALLOW_STALE_FLY_E2E=1` only for partial harnesses

## Watch out

- Live Graph `/api/webhooks/microsoft-graph` is 404 until tip deploy
- Closing PRs does not deploy
