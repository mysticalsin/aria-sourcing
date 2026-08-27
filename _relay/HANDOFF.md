---
project: MSourcing / ARIA
shift: 113
agent: cursor-cloud
updated: 2026-08-27 UTC
status: calendar-activity-shape-fixed-awaiting-fly-confirm
---

# Handoff — Shift 113

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#30**
- **Local gate:** `npx tsc --noEmit && npm test` green on tip after activity-shape fix; audit **29/29**
- **CI Actions:** empty runners (`runner_name:""`, `steps:0`, ~3s) — **not code failures**; skip billing wait; tip `87f48cb` same pattern
- **Fly live:** still build `ba88302` / migration **0060** / `agentFrameworks:false`; tip needs deploy confirm
- **Entra SSO:** still off
- **Vercel:** demo project may build previews — enterprise host remains Fly only

## Done this shift

- Confirmed CI failures on `5221542`/`0a3aaa2`/`87f48cb` are empty-runner (no logs)
- Fixed `calendar_book` activity to durable `Activity` shape (`type:"booking"`, notes/outcome/linkedEntity*)
- Calendar UX: removed “goes live” / “on live send” skeleton copy; Graph confirmLive language
- Prior shift 112: propose-calendar-book cron + worker wiring + parse llm_required + settings UX

## Blockers (owner)

1. `ARIA_PROD_DEPLOY_CONFIRM` → `bash scripts/fly-deploy-now.sh` through **0065**
2. Entra Azure secrets + `NEXT_PUBLIC_ENABLE_AZURE_LOGIN=true`
3. Live M365/Graph/LLM + deployed E2E
4. Actions billing (deferred)

## Next steps

1. Owner deploy confirm against tip SHA
2. Enable Entra when secrets exist
3. Prove Graph webhook + calendar confirmLive on Fly
4. Ignore empty-runner CI until billing fixed

## Decisions made (don't relitigate)

- Skip Actions billing; local gate authority
- Calendar auto-book human-gated; loop proposes only
- Fly-only enterprise host

## Watch out

- Do not Fly-mutate without confirm
- Activities must match `Activity` interface (not free-form worker blobs)
