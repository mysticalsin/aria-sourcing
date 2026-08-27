---
project: MSourcing / ARIA
shift: 116
agent: cursor-cloud
updated: 2026-08-27 UTC
status: intake-fail-closed-shipped-awaiting-fly-confirm
---

# Handoff — Shift 116

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#30** · tip `d37e041`
- **Local gate:** `npx tsc --noEmit && npm test` green (audit 29/29, mantu 28/28)
- **CI Actions:** empty runners — skip
- **Fly live:** still `ba88302` / migration **0060** / `agentFrameworks:false`
- **Owner blockers:** `ARIA_PROD_DEPLOY_CONFIRM` unset; Entra/Graph/LLM secrets absent

## Done this shift

- `/api/intake` production path uses `parseInboundNeedLive`; returns `503 llm_required` without server LLM (matches cron contract)
- Demo mode (no Supabase) keeps heuristic for `e2e-workflow-test.sh`
- New `tests/intake-route.mts`; audit matrix extended
- `fly-deploy-now.sh` messaging updated to migration **0065**; e2e grep for llm_required/critics_required

## Blockers (owner)

1. `ARIA_PROD_DEPLOY_CONFIRM` → deploy through **0065**
2. Entra + live M365 Graph + LLM keys
3. Prove webhook push + confirmLive on Fly

## Next steps

1. Owner deploy confirm
2. Enable Entra when secrets exist
3. Live E2E on Fly

## Decisions made (don't relitigate)

- Skip Actions billing; Fly-only; LinkedIn 409 assisted-manual
- Calendar live book only via `/api/calendar/event` + confirmLive
- Demo heuristic intake OK only when Supabase disabled (open demo)

## Watch out

- Do not Fly-mutate without confirm
- Intake page uses client `parseIntakeLive` — separate from `/api/intake` webhook
