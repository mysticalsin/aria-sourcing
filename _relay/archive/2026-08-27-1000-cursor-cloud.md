---
project: MSourcing / ARIA
shift: 136
agent: cursor-cloud
updated: 2026-08-27 UTC
status: code-complete-awaiting-owner-deploy
---

# Handoff — Shift 136

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#31** open
- **Tip (this shift):** Run Aria direct live fallback; E2E waits for worker campaign materialization; soft live critics on approve/send; audit **43/43**
- **Local gate:** green (`npx tsc --noEmit && npm test`)
- **Fly live:** still stale `ba88302` / mig **0060** / Graph **404**; confirm unset; missing `EMAIL_INBOUND_WEBHOOK_SECRET` + `MICROSOFT_*`
- **Owner blockers:** secrets checklist + deploy confirm + deploy + E2E

## Done this shift

- `executePrimaryAgentSourcing`: when no Flowise/DeerFlow workflow, fall through to live reviewed `sourceNextBatch` (`mode: "direct"`) — no Talent Pool on live
- `e2e-workflow-test.sh`: after webhook queue, poll `workspace_state` ~180s for campaign title (proves loop worker)
- Approve/send: soft `validateOutreachQualityLive` (deterministic first; LLM soft-block)
- Manifest: `dispatch-outbound` uses `--experimental-test-module-mocks`
- Prior shift 135: Outlook route fail-closed + M365 webhook-ready honesty + docs

## Next steps

1. Owner: `bash scripts/print-fly-secrets-checklist.sh` → set Fly secrets
2. Owner: activate → `print-fly-deploy-confirm.sh` → `fly-deploy-now.sh`
3. Owner: `print-fly-e2e-env.sh` → `e2e-workflow-test.sh` (now waits for worker campaign)
4. Agent: ready ok + mig `0066_*` + Graph 200 + E2E PASS → mark goal complete

## Decisions made (don't relitigate)

- PR #31 supersedes closed #29/#30
- No Fly deploy without `ARIA_PROD_DEPLOY_CONFIRM`
- Target migration **0066**
- Mantu Fly: `AGENT_FRAMEWORKS_REQUIRED=false`
- Canonical Graph webhook: `/api/webhooks/microsoft-graph`
- Run Aria may use direct reviewed sourcing when frameworks absent

## Watch out

- E2E worker poll will fail until loop is armed (`ARIA_LOOP_KILL_SWITCH` / workspace kill_switch)
- Soft critics on human approve/send fail open when LLM unavailable (unlike autonomous draft cron)
