---
project: MSourcing / ARIA
shift: 173
agent: cursor-cloud
updated: 2026-08-27T15:55Z
status: tip-code-hardened-awaiting-deploy-confirm
---

# Handoff — Shift 173

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **PR #32** · tip advancing (local uncommitted E2E harden)
- **Live Fly:** still build `ba88302` · mig `0060` · `/api/ready` not_ready · Graph validationToken **404**
- **Drop-zones:** `/tmp/owner-deploy-confirm.env` / `/tmp/owner-microsoft.env` absent; `ARIA_PROD_DEPLOY_CONFIRM` unset (will not invent — use `bash scripts/print-fly-deploy-confirm.sh`)
- **Waiter:** `fly-wait-entra` with `ARIA_SKIP_AZ_DEVICE_REFRESH=1`; triggers on az / microsoft drop-zone / **deploy-confirm alone**

## Done this shift

- Approve/send: fail-closed `critics_required` when live critics missing; **human approval resolves `needs_review`** (only hard-block `blocked`)
- Hermes outreach + E2E canned drafts require **Mantu Group** + signature
- LangGraph `validateQuality` uses live LLM critics when `preferLiveCritics` (draft cron sets true)
- Live critics: one retry on parse/HTTP miss; compliance critic requires Mantu brand
- Microsoft OAuth callback **fail-closed** if Graph subscription create fails
- Settings toast regex covers new Graph webhook error wording

## Next steps

1. Owner: `bash scripts/print-fly-deploy-confirm.sh` → `/tmp/owner-deploy-confirm.env` → tip deploy (golive / `fly-deploy-now.sh`)
2. Owner: `/tmp/owner-microsoft.env` or az login when ready for Outlook OAuth (skipped Entra MFA — do not re-spam)
3. After tip: Connect Outlook (seat mode=live) + webhook → `eval "$(bash scripts/print-fly-e2e-env.sh --export)" && bash e2e-workflow-test.sh`
4. Goal complete only when: ready ok + mig>=0066 + tip build + Graph200 + E2E PASS

## Decisions made (don't relitigate)

- PR #32 supersedes #29–#31
- Never invent Azure secrets or `ARIA_PROD_DEPLOY_CONFIRM` — use `print-fly-deploy-confirm.sh`
- Seat mode=live for Teams book; calendar live only via `/api/calendar/event` + `confirmLive`
- Mantu Fly: `AGENT_FRAMEWORKS_REQUIRED=false` on tip
- LinkedIn send stays 409 assisted-manual; HeyReach = LinkedIn MCP path
- LangGraph = stage checkpoint; live critics via `preferLiveCritics` on draft path
- Owner skipped Entra MFA — watch drop-zones only (`ARIA_SKIP_AZ_DEVICE_REFRESH=1`)

## Watch out

- ba88302 cannot opt out of agentFrameworks — tip deploy mandatory for ready green
- Confirm drop-zone SHA must match clean tree HEAD at deploy time
- Do not commit `/tmp` secrets or drop-zones
- GitHub Actions budget exhausted (CI jobs never start); local gate is authority
