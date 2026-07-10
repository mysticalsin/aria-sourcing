# Production Readiness Status

**Date:** 2026-07-10

This page supersedes the 2026-06-27 due-diligence snapshot in
`PRODUCTION_READINESS_REPORT.md`. It is a current source-tree status page, not a
legal, compliance, or production certification.

## Current Posture

- Stack is now Next.js `^16.2.6`, React `^19.2.7`, TypeScript `^5.6.3`, Node
  `22.x`, verified from `package.json`.
- Test surface is now 98 suite commands via `npm test` including `pretest`.
- Local quality gates for release use `npm run typecheck`, `npm run lint`,
  `npm test`, and `npm run build:isolated` in this OneDrive checkout. In this
  R3 pass, `npx tsc --noEmit` exited 0 and `npm run lint` exited 0 with one
  warning in `src/lib/store.ts`.
- Sourcing is a real shipped surface: GitHub source search, Tavily-backed web
  sourcing, sourcing-agent routes, compliant LinkedIn assisted-manual policy,
  and source-spend demo-session protection are present in code and tests.
- Outreach has durable approval, unsubscribe, dispatch, WhatsApp review,
  late-event, and concurrency migrations through `0018`; `0016` is deliberately
  absent.
- Secrets-at-rest support is built through `DATA_ENCRYPTION_KEY` in
  `src/lib/crypto-secrets.ts`; production credential writes require the key.
- RLS tenancy is encoded in Supabase migrations and server helpers; live cloud
  Supabase still must be provisioned and verified before production claims.
- Candidate-facing disclosure protection is built in
  `src/lib/agent-disclosure-policy.ts` and covered by direct/adversarial tests.
- Executive dashboard, winlog, public careers intake, Databricks intake, and MCP
  query-auth checks are present in the source tree.
- Metric definitions are explicit code, not sales claims: see `src/lib/metrics.ts`
  and `src/lib/exec-dashboard.ts`.

## Data Handling

- Demo mode stays local/dry-run unless Supabase env vars are configured.
- Live mode uses Supabase Auth, workspace-scoped RLS, server-only service-role
  operations, and column/server controls around secrets and OAuth tokens.
- Candidate PII is purpose-limited to recruiting operations. Candidate-facing
  text is checked for disclosure leaks before approval or dispatch.
- Live email requires a configured delivery path, human approval, unsubscribe
  base URL, suppression checks, and domain/OAuth setup.
- WhatsApp delivery requires Meta credentials, consent/template/window checks,
  human review where required, and webhook signature handling.

## Remaining Go-Live Steps

1. Provision cloud Supabase and apply every file in `supabase/migrations/` in
   order with `supabase db push`.
2. Set all required production env vars from `.env.production.example`, including
   `DATA_ENCRYPTION_KEY`, `CRON_SECRET`, `OUTREACH_UNSUBSCRIBE_BASE_URL`, the
   Supabase trio, Google/Microsoft OAuth as needed, and at least one verified
   delivery path before live email.
3. Configure production domain, OAuth redirect URIs, unsubscribe origin, and
   email-domain controls to the final deployment URL.
4. Run the full deploy runbook and bind green gates to the exact release SHA.
5. Perform live Supabase/RLS, restore, and post-deploy smoke verification before
   any real tenant or candidate data is used.
