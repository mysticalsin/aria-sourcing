---
project: MSourcing / ARIA
shift: 172
agent: cursor-cloud
updated: 2026-08-27T15:47Z
status: tip-code-hardened-awaiting-deploy-confirm
---

# Handoff — Shift 172

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **PR #32** · tip `6eca772` (relay pin of `b277ea5`)
- **Live Fly:** still build `ba88302` · mig `0060` · `/api/ready` not_ready · Graph validationToken **404** (ops: owner deploy-confirm)
- **Drop-zones:** `/tmp/owner-deploy-confirm.env` / `/tmp/owner-microsoft.env` absent; `ARIA_PROD_DEPLOY_CONFIRM` unset (will not invent)
- **Code-gap audit (post tip+secrets, excl. ops):** 5 actionable mismatches ranked below — #1 will break live E2E approve after tip

## Done this shift

- Fresh code-gap audit vs enterprise E2E + LangChain/no-fake-UX objective (skip deploy/secrets)
- Confirmed prior gaps fixed: top-10 approve, Mantu brand gate, enterpriseMantuVoice, approve/send critics_required fail-closed, empty email_sync refuse

## Blockers

- Owner deploy-confirm + Microsoft secrets (unchanged; do not invent)
- Code: human approve/send rejects `needs_review` after requiring live critics → stuck loop + E2E LinkedIn approve FAIL

## Next steps

1. **Code (highest impact):** In `src/app/api/outreach/approve/route.ts` + `send/route.ts`, fail-closed only on `!llmCriticsUsed` (non-demo) and `status === "blocked"` — do **not** 422 on `needs_review` (human approval resolves review)
2. **Code:** Force Mantu in `src/app/api/hermes/chat/route.ts` TASK_SYSTEM.outreach + `e2e-workflow-test.sh` draft/canned bodies
3. **Code:** Align LangGraph `validateQuality` with live multi-agent critics (or pass live verdict into graph state from draft cron)
4. **Code:** Fail-closed or auto-retry Graph subscription on OAuth callback (E2E needs `graphSubscription.active`)
5. **Code:** Harden `outreach-quality-pipeline-live.ts` critic JSON parse/retry (partial → silent `llmCriticsUsed:false` → 503)
6. Owner: deploy-confirm → tip deploy → Connect Outlook + webhook → HeyReach connect → `e2e-workflow-test.sh`

## Decisions made (don't relitigate)

- PR #32 supersedes #29–#31
- Never invent Azure secrets or `ARIA_PROD_DEPLOY_CONFIRM`
- Seat mode=live for Teams book; LinkedIn send stays 409 assisted-manual
- Mantu Fly: `AGENT_FRAMEWORKS_REQUIRED=false` on tip
- LangGraph = stage checkpoint after worker/cron side effects (not in-graph tool runtime)
- Owner skipped Entra MFA — watch drop-zones only

## Watch out

- b277ea5 fail-closed critics + rejecting `needs_review` on human approve is the tip-side E2E landmine
- Hermes outreach system prompt never mentions Mantu → deterministic `needs_review` (missing-mantu-brand)
- Draft cron allows `needs_review` through; approve then hard-rejects it — loop cannot complete
- ba88302 cannot opt out of agentFrameworks — tip deploy still mandatory for ready green
