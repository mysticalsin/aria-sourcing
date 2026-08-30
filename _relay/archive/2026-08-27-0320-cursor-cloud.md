---
project: MSourcing / ARIA
shift: 110
agent: cursor-cloud
updated: 2026-08-27 UTC
status: calendar-book-graph-renew-awaiting-fly-confirm
---

# Handoff — Shift 110

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#30**
- **Local gate:** `tsc` + `npm test` green on tip `8a1dbdd`; audit **27/27**; mantu E2E **24/24**
- **CI Actions:** deferred (empty runners) — do not block
- **Fly live:** still migration **0060**; source now through **0065**; deploy needs `ARIA_PROD_DEPLOY_CONFIRM`
- **Entra SSO:** still off in `fly.app.toml` (owner GoTrue Azure config required)

## Done this shift

- Graph subscription **renew** (`renewGraphMailSubscription` / cron `/api/cron/renew-graph-subscriptions` + loop tick)
- Connections API + M365 UI report **real** `graphSubscription` (not inbound route)
- Autonomous drafts **fail closed** without live LLM; quality via `runRecruitingGraph`
- Loop stage **`calendar_book`** (migration 0065): proposes Teams/Outlook interview after INTERESTED (human confirmLive)
- E2E Graph `validationToken` handshake; audit matrix expanded
- Golive target migration **0065**

## Blockers (owner)

1. `ARIA_PROD_DEPLOY_CONFIRM` for Fly-only deploy through **0065**
2. M365 / webhook / LLM secrets on Fly
3. Entra SSO: set GoTrue Azure + `NEXT_PUBLIC_ENABLE_AZURE_LOGIN=true`
4. Actions billing (deferred)

## Next steps

1. Full `npx tsc --noEmit && npm test` green on tip
2. Owner deploy confirm → `bash scripts/fly-deploy-now.sh`
3. Prove Graph webhook + renew + calendar dry-run on aria-mantu-app.fly.dev
4. Enable Entra when Azure GoTrue secrets exist

## Decisions made (don't relitigate)

- Skip Actions billing wait; Fly-only enterprise; LinkedIn assisted-manual 409
- Tracked wiki PII-free; feedback proposes / humans promote
- Calendar auto-book stays human-gated (`confirmLive`); loop only **proposes**

## Watch out

- Do not treat inbound route as Graph subscription proof
- Do not ship mock-ai autonomous drafts as ok:true
- Do not deploy enterprise to Vercel
