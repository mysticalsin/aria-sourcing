---
project: MSourcing / ARIA
shift: 4
agent: cursor
updated: 2026-11-26 15:09 -03
status: in-progress
---

# Handoff — synthetic hire employee id

## Current state
- Branch `cursor/synthetic-hire-employee-id-57b5`, based on `origin/vercel-demo` at `03ace03e1978ffafd80970b4e315f40166a06dd0`.
- `/demo/hire` shows the `hr.employee` id returned for the successful in-repo Odoo hire. The id comes from `FakeOdooEmployeeClient` through `createEmployeeForStage`. On a fresh process the fixture applicant `12` shows employee id `1`.
- The vacancy close on that first render stays `[[11], { no_of_recruitment: 0 }]`, kwargs `{}`, fields `name,no_of_recruitment`, and every recorded host is `https://odoo.example.test/jsonrpc`.
- `npx tsc --noEmit` and `npm test` exited 0. `tests/hire-pipeline.mts` 52 passed. `tests/hire-employee.mts` 13 passed.
- Runtime Odoo credentials are absent. No live host was called. The draft is not merged.

## Done this shift
- The synthetic hire screen shows that employee id.

## Blockers
- None for this screen.

## Next steps
1. Leave the pull request a draft. Do not merge it and do not deploy it.

## Decisions made (don't relitigate)
- Synthetic `/demo/hire` uses the in-repo fake. It does not send runtime credentials and it does not call a live host.
- A hire that does not succeed leaves the employee id empty and does not call the employee client.
- No secrets in git or in `_relay/`.

## Watch out
- A later hire of the same idempotency key in one process reuses the stored Odoo steps, so that later render records no new fake calls. The employee id is still taken from the hired applicant.
