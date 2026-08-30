---
project: MSourcing / ARIA
shift: 112
agent: cursor-cloud
updated: 2026-08-27 UTC
status: calendar-propose-shipped-awaiting-fly-confirm
---

# Handoff — Shift 112

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#30** · tip `5221542`
- **Local gate:** `npx tsc --noEmit && npm test` green; audit matrix **29/29**; mantu-recruiting-e2e-full **27/27**
- **CI Actions:** deferred (empty runners / billing)
- **Fly live:** still migration **0060** class (not_ready / agentFrameworks false last probe); source tree through **0065** + propose cron; needs `ARIA_PROD_DEPLOY_CONFIRM`
- **Entra SSO:** still off (`NEXT_PUBLIC_ENABLE_AZURE_LOGIN=false`)

## Done this shift

- `/api/cron/propose-calendar-book` — claim → default dry-run release (`confirmLive:false`); Mantu agenda
- Worker `calendar_book` → `calendarProposeUrl` then `interview_proposed` activity
- Parse cron fail-closed `503 llm_required` without live LLM
- Draft cron runs LangGraph before `llm_required` (observability) then refuses mock drafts
- Settings: hide roadmap when `!demoLoginEnabled`; Configure disabled for `!integration.real`
- E2E script step 2d: connections GET + Entra/graphSubscription + propose path asserts
- Audit matrix **29/29**; worker test for calendar propose

## Blockers (owner)

1. `ARIA_PROD_DEPLOY_CONFIRM` → `bash scripts/fly-deploy-now.sh` through **0065**
2. Entra: GoTrue Azure secrets + `NEXT_PUBLIC_ENABLE_AZURE_LOGIN=true`
3. Live M365 Graph webhook + LLM keys + deployed E2E with admin creds
4. Actions billing (deferred)

## Next steps

1. Owner deploy confirm against tip SHA only via `scripts/fly-deploy-now.sh`
2. Enable Entra when Azure secrets exist
3. Prove live Graph validationToken + calendar dry-run + Teams path on Fly
4. Do not wait on GitHub Actions; local gate remains authority

## Decisions made (don't relitigate)

- Skip Actions billing; Fly-only enterprise host; LinkedIn send stays 409 assisted-manual
- Calendar auto-book human-gated; loop proposes only (`confirmLive` for Graph)
- Demo samples / roadmap placeholders off on production tenants unless demo login on
- LangGraph = state machine + draft quality; Hermes/tool-loop = sourcing; DB = durable authority

## Watch out

- Do not enable Azure login without GoTrue Azure secrets
- Do not Fly-mutate without `ARIA_PROD_DEPLOY_CONFIRM`
- `outreach-quality-pipeline-live.ts` must stay server-only (module-boundaries)
- Propose cron never creates Graph events unless operator `confirmLive` + Graph configured
