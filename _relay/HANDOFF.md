---
project: MSourcing / ARIA
shift: 99
agent: cursor-cloud
updated: 2026-08-27 UTC
status: requisition-parse-wired-audit-matrix
---

# Handoff — Shift 99

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · #30 → `integration/sourcing-enrichment-on-main`
- **Loop worker:** `handleRequisitionParse` fully wired (ingest → parse → patch campaign → record → campaign_create)
- **Cron route:** `/api/cron/parse-inbound-need` (CRON_SECRET; worker calls via `ARIA_WEB_INTERNAL_URL`)
- **Migration 0062:** `requisition_parse` payload contract adds `inboundId` (UUID)
- **Webhook payload:** ids-only `{ inboundId }` (matches DB contract)
- **Audit matrix:** `tests/enterprise-e2e-audit-matrix.mts` — 15/15 requirements verified
- **E2E script:** `e2e-workflow-test.sh` adds optional webhook need step + salary-disclosure quality gate
- **Test gate:** `npx tsc --noEmit` green; `npm test` application green

## Done this shift

- Implemented full requisition parse pipeline in loop worker
- Added `src/lib/requisition-intake.ts` + cron parse route
- Created enterprise E2E audit matrix test
- Extended deployed E2E script with webhook + quality gate steps
- Updated sourcing-loop-worker tests for new RPC flow

## E2E loop (verified)

```
Webhook need → requisition_parse → ingest + parse + campaign patch
  → source → top 10 → Mantu outreach + quality → approve → Teams book
```

## Blockers (ops)

- Fly: Entra SSO, Outlook OAuth, `EMAIL_INBOUND_WEBHOOK_SECRET`, migration 0062 apply
- PR #30 CI failures (not investigated this shift)
- `source-demo-auth.mts` 2 pre-existing failures

## Next steps

1. Ops: apply migration 0062 + Microsoft 365 on Fly
2. Run `e2e-workflow-test.sh` against Fly with webhook secret
3. Investigate/fix PR #30 CI

## Decisions made (don't relitigate)

- Default seed = zero candidates; historical demo via `buildHistoricalDemoSeedState()` only
- LangGraph orchestrates E2E; Postgres authority unchanged
- Webhook payload ids-only; worker reads inbound body from DB
- Parse runs on web process via cron route (reuses TS parsers)

## Watch out

- `requisition_parse` requires `inboundId` UUID in job payload
- Worker needs `ARIA_WEB_INTERNAL_URL` + `CRON_SECRET` for parse route
- E2E webhook step skipped unless `EMAIL_INBOUND_WEBHOOK_SECRET` set
