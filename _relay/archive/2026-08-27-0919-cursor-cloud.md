---
project: MSourcing / ARIA
shift: 134
agent: cursor-cloud
updated: 2026-08-27 UTC
status: code-complete-awaiting-owner-deploy
---

# Handoff — Shift 134

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#31** open (supersedes closed #29, #30)
- **Tip:** Fly Mantu opts out of DeerFlow/Flowise ready gate (`AGENT_FRAMEWORKS_REQUIRED=false`) so `/api/ready` can go green after tip migrate
- **Local gate:** green; audit **42/42**
- **Fly live:** still stale `ba88302` / mig **0060** / Graph **404**; confirm unset
- **Owner blockers:** secrets (checklist) + `ARIA_PROD_DEPLOY_CONFIRM` + deploy + E2E

## Done this shift

- `/api/ready` honors explicit `AGENT_FRAMEWORKS_REQUIRED=false`
- `fly.app.toml` + `fly-deploy-now.sh` set the opt-out for Mantu (sidecars not on Fly)
- Owner setup actions requested via Cursor environment (Graph/webhook/Entra + deploy confirm)
- Prior: secrets checklist, live UI drafting, Teams joinUrl honesty

## Next steps

1. Owner: `bash scripts/print-fly-secrets-checklist.sh` → set real values
2. Owner: activate → `print-fly-deploy-confirm.sh` → `fly-deploy-now.sh`
3. Owner: E2E via `print-fly-e2e-env.sh`
4. Agent: ready ok + mig `0066_*` + Graph 200 + E2E PASS

## Decisions made (don't relitigate)

- PR #31 supersedes closed #29 and #30
- No Fly deploy without `ARIA_PROD_DEPLOY_CONFIRM`
- Use `bash scripts/print-fly-deploy-confirm.sh` for exact deploy one-liner
- Skip Actions billing; local gate authority
- Target migration **0066**
- Mantu Fly does not require DeerFlow/Flowise for `/api/ready` (explicit false opt-out)

## Watch out

- Full `deploy-fly.sh` / Actions path may still set `AGENT_FRAMEWORKS_REQUIRED=true` — Mantu `fly-deploy-now.sh` is the enterprise path
