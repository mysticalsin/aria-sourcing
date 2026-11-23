---
project: MSourcing / ARIA
shift: 3
agent: cursor-grok
updated: 2026-11-23 15:43 America/Sao_Paulo
status: in-progress
---

# Handoff — generic API and MCP hire connectors

## Current state
- Branch `cursor/generic-mcp-hire-connectors-1dbf`, cut from `vercel-demo` at `f2d0d3d0`.
- `POST /api/hire` and `runSourcingThroughHired` in `src/lib/hire-connector.ts` move one applicant from job create to hired.
- Connector order when `HIRE_CONNECTOR` is unset: Odoo JSON-RPC, SMART, generic HTTPS API (`HIRE_API_URL` + `HIRE_API_TOKEN`), MCP hire tool (`HIRE_MCP_URL` + `HIRE_MCP_TOKEN`, tool `HIRE_MCP_TOOL` or `hire`).
- `HIRE_CONNECTOR=api|mcp|odoo|smart` forces that path.
- Default transport is `fetchPublicUrl` (`src/lib/api/public-fetch.ts`): public HTTPS, DNS pinned, redirects not followed. Base URLs reject embedded credentials, queries, fragments, and blocked hosts.
- A false or empty upstream payload is an error. Error text is scrubbed.
- Demo (`envForHireRequest` with live auth false) drops every connector env var. Result is `{ ok: true, erp: "skipped", linkedIn: true }` and no fetch.
- Gate on this shift: `npx tsc --noEmit` exit 0, `npm test` exit 0, including `tests/hire-connector.mts` (30), `tests/hire-pipeline.mts` (11), `tests/public-fetch-pin.mts` (4). Fakes only.

## Done this shift
- Added the generic API and MCP hire connectors on a branch off `vercel-demo`.
- Kept the Odoo JSON-RPC and SMART hire calls in the same module. They were not present on `vercel-demo` (`f2d0d3d0`). Frozen tip `#287` `7eb1fa9c` was not pushed or retargeted. `#291`–`#294` were not used as a base.

## Blockers
- none

## Next steps
1. Review the draft PR off `vercel-demo`.
2. Do not merge it onto `#287`, `#178`, `#251`, or the `#291`–`#294` stack.

## Decisions made (don't relitigate)
- Odoo remains the first automatic choice, then SMART, then the generic API, then MCP.
- Explicit `HIRE_CONNECTOR` is how a deployment runs the API or MCP path while Odoo is also configured.
- No live Odoo, SMART, LinkedIn, or MCP calls. No LinkedIn browser login, scraping, Voyager, or cookie capture.
- Demo mode never spends connector credentials.

## Watch out
- `vercel-demo` and `main` diverged. This branch is based on `vercel-demo` `f2d0d3d0`, not on `cursor/sourcing-through-hired-bfd1`.
- `#178` `c1332a66`, `#251` `6ba96fb3`, and `#287` `7eb1fa9c` stay frozen.
