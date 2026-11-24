---
project: MSourcing / ARIA
shift: 3
agent: cursor
updated: 2026-11-24 10:56 -03
status: in-progress
---

# Handoff — live Odoo hire path on vercel-demo

## Current state
- Branch `cursor/odoo-live-hire-path-9db8`, based on `vercel-demo` at `f2d0d3d07bdb8eb2bcb1e0d0bbd85e1cf99f9e7e`.
- `npx tsc --noEmit && npm test` passed on this branch. Hire suites: `tests/hire-connector.mts` 62 passed, `tests/hire-pipeline.mts` 46 passed.
- `/demo/hire` renders the synthetic fixture through the in-repo fake Odoo. Vacancy close is `[[11], { no_of_recruitment: 0 }]`, kwargs `{}`, `hr.job.state` not sent. Unset connector result is `{ ok: true, erp: "skipped", linkedIn: true }`.
- `POST /api/hire` uses `hireEnvForRoute(process.env, supabaseEnabled)` and the public HTTPS transport. This machine had no `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, or `ODOO_API_KEY`. No live Odoo host was called.
- Draft only. Not merged. Not deployed. PRs 311, 314, 308, 313, 315, 317, 318, and 289 were not updated.

## Done this shift
- Added the hire connector, fake Odoo, synthetic demo page, and live `POST /api/hire` route.
- Connector order when `HIRE_CONNECTOR` is unset: Odoo, SMART, generic HTTPS API, MCP, otherwise skipped.
- SMART, the generic API, and MCP hire by writing `hr.applicant` `{ id, hired: true }`.

## Blockers
- No live Odoo credentials in this environment, so the live call was not run.

## Next steps
1. Set `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, and `ODOO_API_KEY` on the server that should call Odoo. Leave them unset to keep the skip result.
2. Optional: set `ODOO_HIRED_STAGE_ID` to a positive id. Unset skips the stage write and still closes the job.
3. Keep this pull request a draft until a live call is reviewed. Do not merge it from this handoff.

## Decisions made (don't relitigate)
- Synthetic `/demo/hire` never sends runtime credentials. It uses the in-repo fake.
- Live hire runs only when the connector env is complete. Private, loopback, and metadata hosts are refused.
- Vacancy close never sends `hr.job.state`.
- No secrets in git or in `_relay/`.

## Watch out
- `POST /api/hire` will call the configured public HTTPS Odoo when all four variables are set, including when Supabase is off.
- The existing MCP probe in `src/lib/mcp-client.ts` still uses its own fetch. The hire path uses `fetchPublicUrl`.
