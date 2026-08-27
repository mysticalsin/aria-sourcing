---
project: MSourcing / ARIA
shift: 115
agent: cursor-cloud
updated: 2026-08-27 UTC
status: graph-webhook-repair-shipped-awaiting-fly-confirm
---

# Handoff — Shift 115

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#30** · tip `ab7e564`
- **Local gate:** `npx tsc --noEmit && npm test` green (audit 29/29, mantu 28/28, email-connections 39/39)
- **CI Actions:** empty runners — skip (CI sub unsubscribed)
- **Fly live:** still `ba88302` / migration **0060** / `agentFrameworks:false`
- **Entra / LLM / Graph secrets:** still absent in agent env; `ARIA_PROD_DEPLOY_CONFIRM` unset

## Done this shift

- `ensureGraphMailSubscription()` — create / renew / recreate / unchanged
- POST `/api/email/connections` action `ensure_graph_webhook`
- OAuth callback surfaces Graph webhook failure in redirect message + error toast
- Settings email panel: webhook badges, health gate, **Enable webhook** CTA
- M365 stack hint points to Enable webhook; audit matrix + e2e grep updated

## Blockers (owner)

1. `ARIA_PROD_DEPLOY_CONFIRM` → `bash scripts/fly-deploy-now.sh` through **0065**
2. Entra Azure secrets + `NEXT_PUBLIC_ENABLE_AZURE_LOGIN=true`
3. Live M365 Graph + LLM keys + deployed E2E (webhook push + confirmLive calendar)
4. Actions billing (deferred)

## Next steps

1. Owner deploy confirm against tip SHA `ab7e564`
2. Enable Entra when secrets exist
3. Prove live Graph webhook + confirmLive on Fly after deploy
4. Optional code debt: `/api/intake` heuristic vs cron LLM-fail-closed; LangGraph topology vs worker chain

## Decisions made (don't relitigate)

- Skip Actions billing; Fly-only; LinkedIn 409 assisted-manual
- Calendar live book only via `/api/calendar/event` + confirmLive
- Demo/roadmap off unless demo login on
- Graph webhook repair is manual admin CTA, not silent retry loop

## Watch out

- Do not Fly-mutate without confirm
- `ensure_graph_webhook` returns 503 when Graph credentials / public URL missing
- Activities must match `Activity` interface
