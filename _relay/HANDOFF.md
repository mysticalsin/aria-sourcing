---
project: MSourcing / ARIA
shift: 98
agent: cursor-cloud
updated: 2026-08-27 UTC
status: clean-seed-e2e-verified
---

# Handoff — Shift 98

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · #30 → `integration/sourcing-enrichment-on-main`
- **STATE_VERSION 19:** `buildSeedState()` = clean slate (0 candidates); `buildHistoricalDemoSeedState()` retains 52 demo candidates for tests
- **Migration v19:** purges candidates, outreach, replies, bookings, ledger on upgrade
- **E2E in-process:** `tests/mantu-recruiting-e2e-full.mts` — 24/24 (webhook → parse → source → top10 → quality → LangGraph → agenda)
- **Test gate:** `npx tsc --noEmit` green; `npm test` application group green
- **Browser verified:** localhost:3002 — 0 candidates, 3 campaigns Sourcing @ 0 sourced

## Done this shift

- Purged historical candidates from default seed; migration v19 wipes legacy localStorage worlds
- Added `tests/seed-fixtures.mts` + updated 20+ tests to use historical fixtures where needed
- Fixed test manifest (inbound-email-router, mantu-e2e-loop entries)
- Fixed store-sourcing-actions GitHub/Apollo fixtures for 80% quality floor under camp-e2e
- Fixed sourcing-agent-route-authority mocks (server-only, getServiceSupabase, apify, orchestrator)

## E2E loop (verified in-process)

```
Webhook need → requisition_parse → intake parse → source → top 10
  → Mantu outreach + quality critics → human approve → send → reply → Teams book
```

## Blockers (ops)

- Entra SSO + Outlook OAuth + EMAIL_INBOUND_WEBHOOK_SECRET on Fly
- `source-demo-auth.mts` 2 failures when run via node test mocks (pre-existing; not in critical path)

## Next steps

1. Ops: Microsoft 365 enterprise setup on Fly
2. Wire loop worker `handleRequisitionParse` to intake parse + auto campaign
3. Extend `e2e-workflow-test.sh` with need-webhook + quality gate steps

## Decisions made (don't relitigate)

- Default seed = zero candidates; historical demo via `buildHistoricalDemoSeedState()` only
- LangGraph orchestrates E2E; Postgres authority unchanged
- Top shortlist = 10; LinkedIn manual (409); webhook-only email activation

## Watch out

- Tests needing candidate fixtures must import `historicalSeedState()` / `historicalCandidate()` from `tests/seed-fixtures.mts`
- Clean seed first campaign is `camp-e2e` (TypeScript) — sourcing test fixtures must match 80% floor
