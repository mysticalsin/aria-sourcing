---
project: MSourcing / ARIA
shift: 144
agent: cursor-cloud
updated: 2026-08-27 UTC
status: code-complete-awaiting-owner-deploy
---

# Handoff — Shift 144

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#31** open (supersedes closed #29, #30)
- **Tip:** `acbf015` — Fly E2E requires live Outlook/Teams book (confirmLive + Teams joinUrl)
- **Local gate:** green; audit **45/45**
- **Fly live:** stale `ba88302` / mig **0060** / Graph **404**; `ARIA_PROD_DEPLOY_CONFIRM` unset
- **Flyctl:** unauthorized for apps/secrets from this agent — owner must deploy
- **Owner blockers:** secrets + `bash scripts/print-fly-deploy-confirm.sh` + deploy + E2E

## Done this shift

- E2E step 6b: live Graph seat → confirmLive:true → created + Teams joinUrl (Fly fail-closed)
- Prior: Intw1 honesty, Teams joinUrl UI honesty, switchboard, Graph ingest, ignition

## Next steps

1. Owner: `bash scripts/print-fly-secrets-checklist.sh`
2. Owner: activate → `bash scripts/print-fly-deploy-confirm.sh` → export confirm → `fly-deploy-now.sh`
3. Owner: connect Outlook seat (Teams book proof) → `print-fly-e2e-env.sh` → `e2e-workflow-test.sh`
4. Agent: ready ok + `0066_*` + Graph 200 + E2E PASS → mark goal complete

## Decisions made (don't relitigate)

- PR #31 supersedes closed #29 and #30
- No Fly deploy without `ARIA_PROD_DEPLOY_CONFIRM` — use `bash scripts/print-fly-deploy-confirm.sh`
- Target migration **0066**
- Mantu Fly: `AGENT_FRAMEWORKS_REQUIRED=false`
- Graph webhook: `/api/webhooks/microsoft-graph`
- Env kill-switch AND workspace switchboard must both be armed
- Entra SSO flag ≠ M365-ready
- Booked stage only via live calendar book path
- Fly E2E requires live Teams joinUrl unless ARIA_ALLOW_SKIP_LIVE_CALENDAR=1

## Watch out

- Agent cannot flyctl deploy/secrets (unauthorized)
- Graph 404 until tip deploy
