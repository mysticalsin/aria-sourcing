---
project: MSourcing / ARIA
shift: 142
agent: cursor-cloud
updated: 2026-08-27 UTC
status: code-complete-awaiting-owner-deploy
---

# Handoff — Shift 142

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#31** open (supersedes closed #29, #30)
- **Tip:** `cb3824b` — E2E ignition + Settings loop switchboard
- **Local gate:** green; audit **43/43**
- **Fly live:** stale `ba88302` / mig **0060** / Graph **404**; `ARIA_PROD_DEPLOY_CONFIRM` unset
- **Owner blockers:** secrets (kill-switch false, MICROSOFT_*, webhook, LLM key, Entra) + confirm + deploy + E2E

## Done this shift

- E2E: post-login `set_sourcing_loop_controls` arm; NEED_BODY `Type: Permanent`; mailbox from Outlook connections; bind sourcing-agent to webhook campaign id
- Settings: `LoopSwitchboardPanel` + `/api/sourcing-loop/controls` (GET/PATCH)
- Checklists: ANTHROPIC_API_KEY + switchboard docs
- Prior tip: Graph HTML newlines + 503 retry + message-id parse

## Next steps

1. Owner: `bash scripts/print-fly-secrets-checklist.sh`
2. Owner: activate → `bash scripts/print-fly-deploy-confirm.sh` → export confirm → `fly-deploy-now.sh`
3. Owner: `print-fly-e2e-env.sh` → `e2e-workflow-test.sh`
4. Agent: ready ok + `0066_*` + Graph 200 + E2E PASS → mark goal complete

## Decisions made (don't relitigate)

- PR #31 supersedes closed #29 and #30
- No Fly deploy without `ARIA_PROD_DEPLOY_CONFIRM` — use `bash scripts/print-fly-deploy-confirm.sh`
- Target migration **0066**
- Mantu Fly: `AGENT_FRAMEWORKS_REQUIRED=false`
- Graph webhook: `/api/webhooks/microsoft-graph`
- Env kill-switch AND workspace switchboard must both be armed
- Entra SSO flag ≠ M365-ready

## Watch out

- E2E soft-skips sourcing only when no webhook campaign id; webhook campaign miss is FAIL
- Graph 404 until tip deploy
