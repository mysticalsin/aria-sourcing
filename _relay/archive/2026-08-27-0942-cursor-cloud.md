---
project: MSourcing / ARIA
shift: 135
agent: cursor-cloud
updated: 2026-08-27 UTC
status: code-complete-awaiting-owner-deploy
---

# Handoff — Shift 135

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#31** open (supersedes closed #29, #30)
- **Tip (pre-commit this shift):** honesty fixes for Outlook connect fail-closed + M365 ready requires Graph subscription + webhook-first docs (`FLY_GOLIVE`, `API.md`, `NEEDS_GUIDE`)
- **Local gate:** green (`npx tsc --noEmit && npm test`); audit **42/42**
- **Fly live:** still stale `ba88302` / mig **0060** / Graph **404**; `ARIA_PROD_DEPLOY_CONFIRM` unset; app missing `EMAIL_INBOUND_WEBHOOK_SECRET` + `MICROSOFT_*`
- **Owner blockers:** secrets checklist + deploy confirm + deploy + E2E

## Done this shift

- Microsoft OAuth callback fails closed when `upsert_inbound_mailbox_route` fails (no silent webhook-ready claim)
- M365 settings stack: step-4 / "Microsoft 365 ready" requires `inboundActive && graphSubscriptionActive`
- Docs: `docs/API.md` documents `/api/webhooks/microsoft-graph`; `NEEDS_GUIDE.md` + `FLY_GOLIVE.md` webhook-first owner path
- Audit matrix pins `webhookIntakeReady` + fail-closed callback; email-connections pin

## Next steps

1. Owner: `bash scripts/print-fly-secrets-checklist.sh` → set real values on Fly
2. Owner: `bash scripts/fly-enterprise-activate.sh $(git rev-parse HEAD)`
3. Owner: `bash scripts/print-fly-deploy-confirm.sh` → export confirm → `bash scripts/fly-deploy-now.sh`
4. Owner: `bash scripts/print-fly-e2e-env.sh` → `bash e2e-workflow-test.sh`
5. Agent: prove ready ok + mig `0066_*` + Graph 200 + E2E PASS → then mark goal complete

## Decisions made (don't relitigate)

- PR #31 supersedes closed #29 and #30
- No Fly deploy without `ARIA_PROD_DEPLOY_CONFIRM`
- Use `bash scripts/print-fly-deploy-confirm.sh` for exact deploy one-liner
- Skip Actions billing; local gate authority
- Target migration **0066**
- Mantu Fly does not require DeerFlow/Flowise for `/api/ready` (`AGENT_FRAMEWORKS_REQUIRED=false`)
- Canonical Graph webhook path is `/api/webhooks/microsoft-graph` (not graph-mail)

## Watch out

- Full `deploy-fly.sh` / Actions path may still set `AGENT_FRAMEWORKS_REQUIRED=true` — Mantu `fly-deploy-now.sh` is the enterprise path
- Do not mark goal complete until live Fly E2E passes
