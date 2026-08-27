---
project: MSourcing / ARIA
shift: 140
agent: cursor-cloud
updated: 2026-08-27 UTC
status: code-complete-awaiting-owner-deploy
---

# Handoff — Shift 140

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#31** open (supersedes closed #29, #30)
- **Tip:** LangGraph `source_only` checkpoint on sourcing_batch; prior Graph ingest + E2E probes
- **Local gate:** green; audit **43/43**
- **Fly live:** stale `ba88302` / mig **0060** / Graph **404**; confirm unset
- **Owner blockers:** secrets + `ARIA_PROD_DEPLOY_CONFIRM` via `print-fly-deploy-confirm.sh` + deploy + E2E

## Done this shift

- Graph intent `source_only` → `sourcing_complete`; worker asserts after sourcing_batch before shortlist
- Prior tip: Graph text Prefer+normalize; ingest enqueue honesty; E2E interest→calendar_book + recruiting-graph-stage; Entra flag ≠ M365-ready

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
- Worker LangGraph checkpoints: parse_only → source_only → rank_only → book_only
- Positive interest always enqueues `calendar_book` propose
- Entra SSO NEXT_PUBLIC flag is not M365-ready

## Watch out

- E2E worker poll needs loop armed
- Graph checkpoints skip when `ARIA_WEB_INTERNAL_URL` unset
- recruiting-graph-stage live probe expects 401 until tip deploy
