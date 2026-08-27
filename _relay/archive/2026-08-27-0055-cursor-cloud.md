---
project: MSourcing / ARIA
shift: 100
agent: cursor-cloud
updated: 2026-08-27 UTC
status: test-gate-green-local
---

# Handoff — Shift 100

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#30** (supersedes closed #29)
- **Loop worker:** `handleRequisitionParse` fully wired
- **Audit matrix:** `tests/enterprise-e2e-audit-matrix.mts` — 15/15
- **Mantu E2E:** `tests/mantu-recruiting-e2e-full.mts` — 24/24
- **Test gate (local):** `npx tsc --noEmit`, `npm run typecheck:tests`, `npm run lint` (0 errors), `npm test`, `npm run posttest` — all green
- **CI:** GitHub Actions jobs fail in ~3s with empty steps / BlobNotFound logs (infra issue, not code)

## Done this shift

- Fixed `sourcing-provider-egress-structure` allowlist for `keys/route.ts` probe usage
- Aligned `source-apify-auth` and `sourcing-agent` fixtures to `camp-e2e` TypeScript query policy
- Committed `package-lock.json` from `npm audit fix`
- Verified audit matrix + Mantu E2E + loop worker tests locally

## E2E loop (verified in-process)

```
Webhook need → requisition_parse → ingest + parse + campaign patch
  → source → top 10 → Mantu outreach + quality → approve → Teams book
```

## Blockers (ops / infra)

- Fly: Entra SSO, Outlook OAuth, `EMAIL_INBOUND_WEBHOOK_SECRET`, migration 0062 apply
- PR #30 CI: GitHub Actions runner infra failure (logs 404)
- Deployed E2E: `e2e-workflow-test.sh` needs Fly credentials in env
- npm audit: 4 high vulns remain (postcss/next/langsmith chain; needs `--force` for langgraph)

## Next steps

1. Ops: apply migration 0062 + Microsoft 365 on Fly
2. Run `e2e-workflow-test.sh` against Fly with webhook secret
3. Human/org: restore GitHub Actions runners for PR #30
4. Optional: upgrade `@langchain/*` to clear remaining high audit vulns

## Decisions made (don't relitigate)

- Default seed = zero candidates; historical demo via `buildHistoricalDemoSeedState()` only
- LangGraph orchestrates E2E; Postgres authority unchanged
- Webhook payload ids-only; worker reads inbound body from DB
- Parse runs on web process via cron route (reuses TS parsers)
- Test fixtures must bind queries to `camp-e2e` TypeScript role terms

## Watch out

- `requisition_parse` requires `inboundId` UUID in job payload
- Worker needs `ARIA_WEB_INTERNAL_URL` + `CRON_SECRET` for parse route
- E2E webhook step skipped unless `EMAIL_INBOUND_WEBHOOK_SECRET` set
- GitHub/Apify tests using `language:Go` will fail under clean-seed `camp-e2e`
