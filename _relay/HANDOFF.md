---
project: MSourcing / ARIA
shift: 16
agent: codex
updated: 2026-07-10 10:41
status: tavily-mcp-query-auth-tsc-clean
---

# Handoff - Tavily MCP Query Auth

## Current state
- Tavily hosted MCP query auth is implemented in the existing MCP subsystem.
- `AUTH_QUERY_PARAMS` is a closed enum in `src/lib/types.ts` with `tavilyApiKey`.
- `src/lib/mcp-client.ts` exports `applyMcpAuth(baseUrl, secret, opts)`:
  - bearer default returns the base URL and bearer token unchanged.
  - query auth appends `authQueryParam=<vault secret>` via `URL.searchParams` and returns an empty bearer token.
  - query auth throws if the base URL already contains the auth param, case-insensitive, or if the param is missing.
- Runtime dialers validate the key-free base URL with `assertPublicUrl` before applying query auth:
  - `src/app/api/hermes/chat/route.ts`
  - `src/app/api/mcp/test/route.ts`
- MCP client and test-route failures return host-only errors for MCP connection/tool-call paths.
- `src/lib/log-redact.ts` redacts closed-list auth query params before any generic secret redaction.
- `src/lib/mcp-auth-params.ts` centralizes base URL rejection for auth query params and is used by store and route schemas.
- `src/components/settings/mcp-servers-panel.tsx` exposes admin-only auth style and query param controls.
- `scripts/probe-tavily-mcp.mts` now uses `applyMcpAuth` instead of hand-assembling the Tavily URL.
- `src/lib/ai/tool-loop.ts` has the requested single-line TODO for the pre-existing DNS-rebind redial gap.

## Done this shift
- Required navigation and context:
  - `graphify query "MSourcing Tavily MCP query auth existing MCP subsystem mcp-client gatherMcpServers"` failed because `graphify-out/graph.json` is absent.
  - `graphify-out/wiki/index.md` is absent.
  - Read `_relay/HANDOFF.md`, vault guardrails, project-local Codex memory, `.rocket-fuel/design-tavily-mcp.md` through v3, and the MCP files named in the brief.
- Added `AUTH_QUERY_PARAMS` / `AuthQueryParam` and `McpServerConfig.authStyle/authQueryParam`.
- Added `applyMcpAuth` and host-only MCP client errors.
- Added central auth query redaction and focused helper coverage.
- Added base URL auth-param rejection in store add/update and both API route schemas.
- Threaded auth fields through store test payloads, chat MCP payloads, `gatherMcpServers`, and `/api/mcp/test`.
- Updated settings UI for Bearer header vs URL query param.
- Refactored the Tavily live probe onto `applyMcpAuth`.
- Added and wired `tests/mcp-query-auth.mts` into `npm test`.
- Archived previous baton to `_relay/archive/2026-07-10-1041-codex.md`.
- Added project-local Codex learning in `_agent_state/codex/memory.json`.

## Blockers
- Live Tavily probe was not run in this sandbox. The brief assigns the live `scripts/probe-tavily-mcp.mts` run to Visionary outside the sandbox.

## Verification
- `node --import tsx tests/mcp-query-auth.mts` passed:
  - `RESULT mcp-query-auth: 15 passed, 0 failed`
- `node --import tsx tests/log-redact.mts` passed:
  - `RESULT log-redact: 24 passed, 0 failed`
- `npx tsc --noEmit` passed with exit 0.
- `git diff --check -- src/lib/types.ts src/lib/mcp-auth-params.ts src/lib/log-redact.ts src/lib/mcp-client.ts src/lib/store.ts src/app/api/hermes/chat/route.ts src/app/api/mcp/test/route.ts src/components/settings/mcp-servers-panel.tsx src/lib/ai/tool-loop.ts scripts/probe-tavily-mcp.mts tests/mcp-query-auth.mts package.json` passed with exit 0.

## Next steps
1. Visionary should run `scripts/probe-tavily-mcp.mts` live outside the sandbox with a real `TAVILY_API_KEY`.
2. Review and commit this MCP integration separately from pre-existing `.rocket-fuel`, `Aria/`, and other dirty-tree files.
3. A later MCP hardening rock should close the documented DNS-rebind redial gap for all remote MCP servers.

## Decisions made (don't relitigate)
- Existing bearer MCP configs remain backward-compatible by default.
- The persisted MCP `url` remains key-free; query auth is assembled only after vault resolution and base URL SSRF validation.
- `authQueryParam` is closed to `AUTH_QUERY_PARAMS`; adding a future query-auth MCP requires extending that enum.
- MCP client errors intentionally do not echo upstream MCP error text, because query-auth servers can echo short secrets that generic redactors cannot prove safe.
- DNS-rebind redial mitigation is out of scope for this rock and pre-existed query auth.

## Watch out
- The working tree had substantial pre-existing untracked `.rocket-fuel`, `Aria/`, `graphify-out/`, and script files before this shift.
- `scripts/probe-tavily-mcp.mts` was already untracked before this shift; this shift edited it in place.
- `package.json` test chain now includes `tests/mcp-query-auth.mts`.
