---
project: MSourcing / ARIA
shift: 175
agent: cursor-cloud
updated: 2026-08-27T16:15Z
status: tip-code-hardened-awaiting-deploy-confirm
---

# Handoff — Shift 175

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **PR #32** · tip advancing (honesty UX in flight)
- **Live Fly:** still build `ba88302` · mig `0060` · `/api/ready` not_ready · Graph validationToken **404**
- **Drop-zones:** `/tmp/owner-deploy-confirm.env` / `/tmp/owner-microsoft.env` absent; `ARIA_PROD_DEPLOY_CONFIRM` unset (will not invent — use `bash scripts/print-fly-deploy-confirm.sh`)
- **Waiter:** `fly-wait-entra` with `ARIA_SKIP_AZ_DEVICE_REFRESH=1`

## Done this shift

- Outlook/Teams hydrate: **degraded** unless `graphSubscription.active`
- `/api/email/test`: fail-closed without active Graph webhook subscription
- Teams Test copy requires webhook + live seat for confirmLive claim
- LinkedIn stack: no "Ready for outreach"; assisted-manual / 409 honesty
- OAuth: promote `mode=live` **only after** inbound route + Graph subscription succeed

## Next steps

1. Owner: `bash scripts/print-fly-deploy-confirm.sh` → `/tmp/owner-deploy-confirm.env` → tip deploy
2. Owner: Microsoft secrets when ready for Outlook OAuth
3. After tip: Connect Outlook + webhook → `eval "$(bash scripts/print-fly-e2e-env.sh --export)" && bash e2e-workflow-test.sh`
4. Goal complete only when: ready ok + mig>=0066 + tip build + Graph200 + E2E PASS

## Decisions made (don't relitigate)

- PR #32 supersedes #29–#31
- Never invent Azure secrets or `ARIA_PROD_DEPLOY_CONFIRM` — use `print-fly-deploy-confirm.sh`
- Seat mode=live for Teams book; calendar live only via `/api/calendar/event` + `confirmLive`
- LinkedIn send stays 409 assisted-manual; HeyReach = LinkedIn MCP path
- Owner skipped Entra MFA — watch drop-zones only

## Watch out

- ba88302 cannot opt out of agentFrameworks — tip deploy mandatory
- Confirm drop-zone SHA must match clean tree HEAD
- GitHub Actions budget exhausted; local gate is authority
