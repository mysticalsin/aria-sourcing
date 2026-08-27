---
project: MSourcing / ARIA
shift: 114
agent: cursor-cloud
updated: 2026-08-27 UTC
status: propose-book-path-wired-awaiting-fly-confirm
---

# Handoff — Shift 114

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#30** · tip `444cde5`
- **Local gate:** `tsc` + targeted worker/audit/mantu green; full `npm test` after push
- **CI Actions:** empty runners — skip (CI sub unsubscribed)
- **Fly live:** still `ba88302` / migration **0060** / `agentFrameworks:false`
- **Entra / LLM / Graph secrets:** still absent in agent env; `ARIA_PROD_DEPLOY_CONFIRM` unset

## Done this shift

- Positive `inbound_classify` → `merge_candidate_patch` stage **Interested**
- `calendar_book` persists structured `candidate.interviewProposal` + Interested
- Calendar **Confirm slot** passes `interviewProposal.startTime` into `createBookingFor`
- Propose cron rejects `confirmLive:true` (`use_calendar_event_route`)
- Autonomous drafts require `llmCriticsUsed` (`critics_required`)
- Setup guide + Hermes settings copy: webhook-first / no mock on prod tenants

## Blockers (owner)

1. `ARIA_PROD_DEPLOY_CONFIRM` → `bash scripts/fly-deploy-now.sh` through **0065**
2. Entra Azure secrets + `NEXT_PUBLIC_ENABLE_AZURE_LOGIN=true`
3. Live M365 Graph + LLM keys + deployed E2E
4. Actions billing (deferred)

## Next steps

1. Owner deploy confirm against tip SHA
2. Graph subscription repair UI (still open code gap if time)
3. Enable Entra when secrets exist
4. Prove live Graph webhook + confirmLive on Fly

## Decisions made (don't relitigate)

- Skip Actions billing; Fly-only; LinkedIn 409 assisted-manual
- Calendar live book only via `/api/calendar/event` + confirmLive
- Demo/roadmap off unless demo login on

## Watch out

- Do not Fly-mutate without confirm
- Activities must match `Activity` interface
- `interviewProposal` cleared when booking saved
