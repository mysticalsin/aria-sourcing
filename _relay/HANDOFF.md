---
project: MSourcing / ARIA
shift: 174
agent: cursor-cloud
updated: 2026-08-27T16:06Z
status: tip-code-hardened-awaiting-deploy-confirm
---

# Handoff — Shift 174

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **PR #32** · tip `fbbdf91`
- **Live Fly:** still build `ba88302` · mig `0060` · `/api/ready` not_ready · Graph validationToken **404**
- **Drop-zones:** `/tmp/owner-deploy-confirm.env` / `/tmp/owner-microsoft.env` absent; `ARIA_PROD_DEPLOY_CONFIRM` unset (will not invent)
- **Post-fbbdf91 code-gap audit (skip ops):** 3 remaining FAKE/SKELETON honesty gaps ranked below

## Done this shift

- Audited tip `fbbdf91` vs M365/Outlook/Teams/calendar/outreach loop after known fixes (needs_review, Hermes Mantu, preferLiveCritics, OAuth fail-closed toast, empty email_sync, webhook-first copy)
- Ranked top-3 remaining misleading UX / E2E landmines (file-level)

## Blockers

- Owner deploy-confirm + Microsoft secrets (unchanged; do not invent)

## Next steps

1. **Code #1 (webhook honesty):** `src/lib/integrations.ts` `mailboxIntegrationPatchesFromConnections` — mark Outlook/Teams `degraded` when Microsoft Graph connection lacks `graphSubscription.active`; `src/app/api/email/test/route.ts` fail closed without active Graph sub; `src/lib/store.ts` Teams Test must not claim confirmLive-ready without webhook. Extend `tests/mailbox-integration-hydrate.mts` + `tests/email-connections.mts`.
2. **Code #2 (LinkedIn honesty):** `src/components/settings/linkedin-outreach-stack.tsx` — replace "Ready for outreach" + footer "unless HeyReach MCP is connected" (implies auto-send). Keep assisted-manual/409 as settled; HeyReach = MCP tools only. Grep-assert in `tests/enterprise-e2e-audit-matrix.mts`.
3. **Code #3 (OAuth durable dual-state):** `src/app/auth/microsoft/callback/route.ts` — do not promote `agent_seats.mode=live` (or roll back connection) until inbound route + Graph subscription succeed; today fail-closed toast coexists with Connected hydration. Cover in `tests/email-connections.mts`.
4. Owner: deploy-confirm → tip deploy → Connect Outlook + webhook → `e2e-workflow-test.sh`

## Decisions made (don't relitigate)

- PR #32 supersedes #29–#31
- Never invent Azure secrets or `ARIA_PROD_DEPLOY_CONFIRM`
- Seat mode=live for Teams book; calendar live only via `/api/calendar/event` + `confirmLive`
- LinkedIn send stays 409 assisted-manual; HeyReach = LinkedIn MCP path
- LangGraph = stage checkpoint; live critics via `preferLiveCritics` on draft path
- Owner skipped Entra MFA — watch drop-zones only (`ARIA_SKIP_AZ_DEVICE_REFRESH=1`)

## Watch out

- Tip OAuth fail-closed only changes redirect; connection+live seat already written → hydration lies without #1/#3
- ba88302 cannot opt out of agentFrameworks — tip deploy mandatory for ready green
- Do not commit `/tmp` secrets or drop-zones
