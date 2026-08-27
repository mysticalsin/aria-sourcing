---
project: MSourcing / ARIA
shift: 171
agent: cursor-cloud
updated: 2026-08-27T15:35Z
status: tip-code-hardened-awaiting-deploy-confirm
---

# Handoff — Shift 171

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **PR #32** · tip `b277ea5`
- **Live Fly:** still build `ba88302` · mig `0060` · `/api/ready` not_ready (agentFrameworks) · Graph validationToken **404**
- **Login:** twalteur@amaris.com admin OK (credentials in `/tmp/aria-e2e-admin-*`, mode 600)
- **Secrets:** 6 Microsoft/Entra still MISSING; `AGENT_FRAMEWORKS_REQUIRED=false` set on app (ignored by stale image)
- **Drop-zones:** `/tmp/owner-deploy-confirm.env` absent · `/tmp/owner-microsoft.env` absent · `ARIA_PROD_DEPLOY_CONFIRM` unset (will not invent)
- **Waiter:** `fly-wait-entra` restarted with `ARIA_SKIP_AZ_DEVICE_REFRESH=1`; triggers on az login, microsoft drop-zone, **or deploy-confirm alone**

## Done this shift

- Waiter: deploy-confirm-only golive path + skip device refresh
- Approve/send: fail-closed `critics_required` when live LLM critics unavailable (non-demo)
- Settings Get started copy: webhook-first / no inbox polling
- `email_sync` refuses empty `inboundIds` (no polling stand-in)
- LangGraph header: honest stage-checkpoint (real work in worker/cron)

## Next steps

1. Owner: `bash scripts/print-fly-deploy-confirm.sh` → write `/tmp/owner-deploy-confirm.env` (or export) → tip deploy via golive / `fly-deploy-now.sh`
2. Owner (when ready): `/tmp/owner-microsoft.env` or az login → Graph OAuth (skipped Entra MFA earlier — do not re-spam)
3. After tip: Connect Outlook (seat mode=live) + webhook → `eval "$(bash scripts/print-fly-e2e-env.sh --export)" && bash e2e-workflow-test.sh`
4. Goal complete only when: ready ok + mig>=0066 + tip build + Graph200 + E2E PASS

## Decisions made (don't relitigate)

- PR #32 supersedes #29–#31
- Never invent Azure secrets or `ARIA_PROD_DEPLOY_CONFIRM` — use `print-fly-deploy-confirm.sh`
- Seat mode=live for Teams book; calendar live only via `/api/calendar/event` + `confirmLive`
- Mantu Fly: `AGENT_FRAMEWORKS_REQUIRED=false` on tip
- LinkedIn send stays 409 assisted-manual; HeyReach = LinkedIn MCP path
- Owner skipped Entra MFA — watch drop-zones only (`ARIA_SKIP_AZ_DEVICE_REFRESH=1`)

## Watch out

- ba88302 cannot opt out of agentFrameworks — tip deploy mandatory for ready green
- Confirm drop-zone SHA must match clean tree HEAD at deploy time
- Do not commit `/tmp` secrets or drop-zones
