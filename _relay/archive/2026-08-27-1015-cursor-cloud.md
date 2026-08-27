---
project: MSourcing / ARIA
shift: 138
agent: cursor-cloud
updated: 2026-08-27 UTC
status: code-complete-awaiting-owner-deploy
---

# Handoff — Shift 138

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#31** open (supersedes closed #29, #30)
- **Tip:** Positive interest → calendar_book propose always; LangGraph shortlistIds bind drafts; live critics honor needs_review when llmCriticsUsed
- **Local gate:** green; audit **43/43**
- **Fly live:** stale `ba88302` / mig **0060** / Graph **404**; confirm unset
- **Owner blockers:** secrets + `ARIA_PROD_DEPLOY_CONFIRM` via `print-fly-deploy-confirm.sh` + deploy + E2E

## Done this shift

- `inbound_classify` always enqueues `calendar_book` on positive interest (pipeline-transitions updated)
- Rank checkpoint returns/binds `shortlistIds` to draft successors
- Approve/send: when `llmCriticsUsed`, reject `needs_review` as well as `blocked`
- Prior: LangGraph worker checkpoints, Run Aria direct, E2E worker wait

## Next steps

1. Owner: `bash scripts/print-fly-secrets-checklist.sh`
2. Owner: activate → `bash scripts/print-fly-deploy-confirm.sh` → `fly-deploy-now.sh`
3. Owner: `print-fly-e2e-env.sh` → `e2e-workflow-test.sh`
4. Agent: ready ok + `0066_*` + Graph 200 + E2E PASS → mark goal complete

## Decisions made (don't relitigate)

- PR #31 supersedes closed #29 and #30
- No Fly deploy without `ARIA_PROD_DEPLOY_CONFIRM` — use `bash scripts/print-fly-deploy-confirm.sh`
- Target migration **0066**
- Mantu Fly: `AGENT_FRAMEWORKS_REQUIRED=false`
- Graph webhook: `/api/webhooks/microsoft-graph`
- Worker invokes LangGraph as stage authority (handlers keep side effects)
- Positive interest always enqueues `calendar_book` propose (autopilot draft is optional)

## Watch out

- E2E worker poll needs loop armed
- Graph checkpoints skip when `ARIA_WEB_INTERNAL_URL` unset
