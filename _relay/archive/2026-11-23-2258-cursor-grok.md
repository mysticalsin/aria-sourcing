---
project: MSourcing / ARIA
shift: 439
agent: cursor-grok
updated: 2026-11-23T19:59Z
status: draft-pr
---

# Handoff — Shift 439

## Current state

- Branch `cursor/hire-api-mcp-connectors-ec87`, started at `b27c06822882a43ddf748f148717ac9b89cd8394` (`cursor/hire-action-ui-defa`).
- `POST /api/hire` order when `HIRE_CONNECTOR` is unset: Odoo, then SMART, then generic HTTPS API (`HIRE_API_URL` and `HIRE_API_TOKEN`), then MCP (`HIRE_MCP_URL` and `HIRE_MCP_TOKEN`, tool `HIRE_MCP_TOOL` or `hire`), otherwise `{ ok: true, erp: "skipped", linkedIn: true }` and no upstream request.
- `HIRE_CONNECTOR=odoo|smart|api|mcp` selects that path. Demo requests drop those connector variables.
- Generic API posts to `/v1/hire/{hr.job|hr.applicant}`. MCP does initialize, notifications/initialized, then tools/call. Both use `fetchPublicUrl` and `redirect: "error"`. A false or empty upstream payload is an error. Tokens are scrubbed from error text.
- Odoo `execute_kw` uses positional args: create `[[vals]]`, write `[[id], vals]`, kwargs `{}`. Authenticate stays on `common` and is not logged. Job create sends `name` only. Applicant create sends `name`, `partner_name`, `email_from`, and numeric `job_id`. A hired stage write is sent only when `ODOO_HIRED_STAGE_ID` is a positive id; otherwise that step is skipped with reason "Hired stage id is not configured." The hire step writes the created `hr.job` to `{ state: "open", no_of_recruitment: 0 }`, which is Odoo's stop-recruiting write, and does not close a different job.
- A successful hire sets that candidate's campaign to `Filled`. The drawer says the vacancy is filled and closed. It does not ask anyone to mark it filled.
- `npx tsc --noEmit` and `npm test` are the gate for this branch, with flyctl 0.5.15 on `PATH` and `FLY_API_TOKEN=local-validate-only`.
- `workers/graphify-lessons/Dockerfile` was not edited. `workers/graphify-lessons/test_worker.py` still rejects `apt-get` in that file. The upgrade line is on the base tip and is expected to be reverted on `cursor/hire-action-ui-defa`.

## Done this shift

1. Generic HTTPS API and MCP hire connectors beside the existing Odoo and SMART connectors. Odoo and SMART function bodies were left as they were on `b27c0682`.
2. Hire drawer labels for `erp: "api"` and `erp: "mcp"`.
3. Blank `HIRE_API_*`, `HIRE_MCP_*`, and `HIRE_CONNECTOR` entries in the env examples.

## Blockers

- None for this slice. The graphify image no-apt failure belongs to the base tip, not this diff.

## Next steps

1. Open the draft PR onto `cursor/hire-action-ui-defa`. Do not push that branch and do not move PR #308.
2. Leave the graphify Dockerfile apt line for the revert on `cursor/hire-action-ui-defa`.

## Decisions made (don't relitigate)

- Zod stays on 3.x on older local main notes; this branch already carries the Zod 4.6.7 change from `b27c0682`. Do not downgrade it here.
- LinkedIn policy stays assisted-manual or official Recruiter System Connect
- Do not copy cookie scraping, login evasion, Voyager, or the LinkedIn browser bridge
- `linkedInSourcingRunsWithoutErp` returns true. Connector sync is gated separately
- Unset `HIRE_CONNECTOR` prefers Odoo, then SMART, then the generic API, then MCP
- Demo hire requests strip Odoo, SMART, generic API, and MCP credentials
- Do not edit `workers/graphify-lessons/Dockerfile` on this branch
- #49 closed permanently; #51 was the Europe successor
- Slim Fly deploy preserves live 0079 migration identity

## Watch out

- `tests/public-fetch.mts` forbids a `fetch(` call in `src/lib/mcp-client.ts`. The hire runner takes an injected fetch and does not call `fetch(`
- `POST /api/hire` uses the same demo, origin, rate-limit, and `source` permission gates as `POST /api/source`
- A partial connector env does not call fetch; LinkedIn sourcing still completes
- Manifest contract hashes must be recomputed when a test is added. This shift only extended existing hire tests
- `FLY_API_TOKEN=local-validate-only` is only for local `flyctl config validate`. Do not commit it
- Do not push `cursor/hire-action-ui-defa`
