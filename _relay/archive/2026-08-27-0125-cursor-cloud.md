---
project: MSourcing / ARIA
shift: 101
agent: cursor-cloud
updated: 2026-08-27 UTC
status: audit-clean-local-gate-green
---

# Handoff — Shift 101

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#30** (supersedes closed #29)
- **Local gate:** `npx tsc --noEmit`, `typecheck:tests`, `npm test`, `posttest` — green (0 suite failures)
- **npm audit --audit-level=high:** **0 vulnerabilities** (overrides: postcss 8.5.26, js-yaml 4.3.2, nanoid 3.3.18, langsmith 0.9.0, uuid 11.1.1)
- **Audit matrix / Mantu E2E:** 15/15 + 24/24
- **CI:** repo-wide Actions failure — jobs get **no runner** (`runner_name=""`, `steps:[]`, ~3s). Affects `main` too, not just this PR.
- **Fly prod (`aria-mantu-app`):** healthy web+loop; `/api/ready` **503** (`agentFrameworks:false`); migration stuck at **0060** (needs **0062**); no `EMAIL_INBOUND_WEBHOOK_SECRET` / Entra / Outlook secrets listed

## Done this shift

- Cleared Dependency audit locally via package overrides (no LangChain 1.x major bump)
- Fixed clean-seed regressions: web-leads, store-campaign-actions, store-booking-report-actions, sourcing-query-policy, declared-dependencies `@types/*` mapping
- Updated test-manifest freeze counts/hashes for new E2E suites (application 172 / all 225)

## Blockers (ops / infra — not code)

1. GitHub Actions runners unavailable org-wide
2. Fly: apply migrations through 0062, enable agent frameworks, set M365 + webhook secrets, redeploy this branch
3. Deployed E2E needs `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ANON_KEY` (not in agent env)

## Next steps

1. Human: restore GitHub Actions billing/runners → re-run PR #30 CI
2. Ops: migrate Fly to 0062 + deploy `cursor/enterprise-autopilot-b91d` build
3. Ops: set `EMAIL_INBOUND_WEBHOOK_SECRET`, Entra SSO, Outlook OAuth; run `e2e-workflow-test.sh`

## Decisions made (don't relitigate)

- Default seed = zero candidates; historical demo via `buildHistoricalDemoSeedState()` only
- Prefer npm `overrides` for audit-critical transitive deps over breaking `@langchain/*` 1.x upgrade
- Webhook payload ids-only; parse via cron route on web process

## Watch out

- Tests that need candidates must use `buildHistoricalDemoSeedState()` / `historicalSeedState()`
- GitHub/Apify fixtures must bind to `camp-e2e` TypeScript role terms
- Fly is still on older release SHA — code on this PR is not yet production-active
