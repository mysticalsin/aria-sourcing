---
project: MSourcing / ARIA
shift: 4
agent: cursor
updated: 2026-11-26 12:22 -03
status: in-progress
---

# Handoff — generic API and MCP hire path on current vercel-demo

## Current state
- Branch `cursor/generic-mcp-hire-connectors-1dbf`. Previous tip `817032cb076ddf3c711e309fee86e3ce89988ff2` did not contain `03ace03e`.
- This shift merges `origin/vercel-demo` at `03ace03e` (PR #319) which already contains `295c08fd` (PR #323).
- Kept from vercel-demo: live Odoo hire (`hireEnvForRoute`, vacancy close `[[id], { no_of_recruitment: 0 }]`, no `hr.job.state`, hired stage only when `ODOO_HIRED_STAGE_ID` is a positive integer), employee creation when the stage writer moves someone to Hired, and the sourcing-screen fixture path.
- Kept from this branch: generic HTTPS API and MCP hire (`HIRE_API_*`, `HIRE_MCP_*`, `HIRE_CONNECTOR`), refusal of string `false` / `null` ids, MCP `notifications/initialized` failure stops before `tools/call`, SSE JSON-RPC tool results, and the pinned public HTTPS transport (`fetchPublicUrl`, private IPv6 including mapped and embedded addresses).
- Unset `HIRE_CONNECTOR` still selects Odoo, then SMART, then the generic API, then MCP. A complete runtime connector is called even when Supabase is off. An empty env stays skipped.
- Local `npx tsc --noEmit` and `npm test` exited 0 on this tree before the push. Hire counts: `tests/hire-connector.mts` 79, `tests/hire-pipeline.mts` 52, `tests/sourcing-screen-hire.mts` 11, `tests/hire-edge.mts` 26, `tests/hire-employee.mts` 13, `tests/public-fetch-pin.mts` 13. No CI result is recorded in this note.
- Draft PR https://github.com/mysticalsin/aria-sourcing/pull/307 only. Not marked ready. Not merged. The PR body was not edited.

## Done this shift
- Merged current `origin/vercel-demo` into the generic API and MCP hire branch and resolved the hire, lockfile, env, and handoff conflicts without dropping either path.

## Blockers
- None in the local gate. CI on the new tip has not been claimed here.

## Next steps
1. Leave PR #307 a draft. Do not merge it.
2. Read the CI result for the new tip when it finishes. Do not treat an older tip's checks as this tip.
3. A live Odoo, SMART, API, or MCP call still waits on real runtime variables. Do not invent them.

## Decisions made (don't relitigate)
- Odoo vacancy close never sends `hr.job.state`. A create result of `true` is not a job id.
- One employee per hired applicant, and only when a client is injected. No client means no call.
- Generic API and MCP stay beside Odoo and SMART. `HIRE_CONNECTOR=api` or `mcp` selects that path when Odoo is also configured.
- The default live transport pins DNS and does not follow redirects. Tests install a fake and do not open a socket.
- The audit gate stays blocking. Do not `npm audit fix --force`.
- No secrets in git or in `_relay/`.

## Watch out
- `POST /api/hire` calls a complete public HTTPS connector even when Supabase is off.
- The route proof installs the fake with `_installPublicFetchForTests`. Replacing `globalThis.fetch` does not reach the pinned transport.
- `@dust-tt/client@1.2.11` prints an engine warning on Node 20 and Node 22. CI still uses Node 20.
