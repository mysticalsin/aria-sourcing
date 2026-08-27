---
project: MSourcing / ARIA
shift: 141
agent: cursor-cloud
updated: 2026-08-27 UTC
status: code-complete-awaiting-owner-deploy
---

# Handoff — Shift 141

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#31** open (supersedes closed #29, #30)
- **Tip:** `b5cd2ee` — Graph HTML newline preserve + webhook 503 retry + message-id parse + kill-switch checklist + `tests/graph-mail-ingest.mts`
- **Local gate:** `npx tsc --noEmit && npm test` green; audit **43/43**; graph-mail-ingest **8/8**
- **Fly live:** stale `ba88302` / mig **0060** / Graph **404**; `ARIA_PROD_DEPLOY_CONFIRM` unset; `flyctl secrets list` unauthorized from agent
- **Owner blockers:** secrets (incl. `ARIA_LOOP_KILL_SWITCH='false'`) + confirm via `print-fly-deploy-confirm.sh` + deploy + E2E

## Done this shift

- `normalizeGraphMessageBody`: only treat as HTML when `contentType===html`; preserve `<br>`/`</p>` as newlines for Mantu field lines
- Graph webhook POST returns **503** on `message_fetch_failed` / `ingest_503` (Graph redelivery)
- `extractMessageId`: `@odata.id` + last `/messages/` segment (IDs may contain `/`)
- Secrets checklist documents `ARIA_LOOP_KILL_SWITCH='false'`
- New `tests/graph-mail-ingest.mts`; audit/email-inbound pins fixed; gate green

## Next steps

1. Owner: `bash scripts/print-fly-secrets-checklist.sh` (set MICROSOFT_*, EMAIL_INBOUND_WEBHOOK_SECRET, ADMIN_*, kill-switch false)
2. Owner: `bash scripts/fly-enterprise-activate.sh $(git rev-parse HEAD)` → `print-fly-deploy-confirm.sh` → export confirm → `fly-deploy-now.sh`
3. Owner: `print-fly-e2e-env.sh` → `e2e-workflow-test.sh`
4. Agent on timer: if confirm set → deploy; if ready+0066+Graph200+secrets → E2E; else status-only
5. Agent: ready ok + `0066_*` + Graph 200 + E2E PASS → mark goal complete

## Decisions made (don't relitigate)

- PR #31 supersedes closed #29 and #30
- No Fly deploy without `ARIA_PROD_DEPLOY_CONFIRM` — use `bash scripts/print-fly-deploy-confirm.sh`
- Target migration **0066**
- Mantu Fly: `AGENT_FRAMEWORKS_REQUIRED=false`
- Graph webhook: `/api/webhooks/microsoft-graph`
- Worker LangGraph checkpoints: parse_only → source_only → rank_only → book_only
- Positive interest always enqueues `calendar_book` propose
- Entra SSO NEXT_PUBLIC flag is not M365-ready
- HTML body normalize only when Graph declares `contentType=html` (angle-bracket emails stay text)

## Watch out

- E2E worker poll needs loop armed (`ARIA_LOOP_KILL_SWITCH=false`)
- Graph checkpoints skip when `ARIA_WEB_INTERNAL_URL` unset
- Live Fly still on pre-Graph-route image until tip deploy (Graph 404 is expected until then)
