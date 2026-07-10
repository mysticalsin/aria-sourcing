You are the Integrator building the approved Tavily-MCP-for-ARIA integration (.rocket-fuel/design-tavily-mcp.md, sections up to v3). workspace-write. Security-sensitive (a secret goes in a URL). Owner standard, non-negotiable: clear for senior full-stack devs, enterprise-ready, well-structured, NO slop — small single-responsibility surface, reuse existing machinery, backward-compatible, no dead code, no redundant comments.

Objective: let ARIA agents call Tavily's hosted MCP server (search/extract/research tools) by adding URL-query auth support to the existing MCP subsystem, with the Tavily key stored ONLY in the encrypted vault and provably un-leakable into any URL field, log, or error.

Read first: (understand before editing)
- src/lib/mcp-client.ts — post/connectAndListTools/callMcpTool (transport, Bearer auth, error returns at ~90,131,144).
- src/app/api/hermes/chat/route.ts gatherMcpServers (~127-175) + its zod payload (~63); src/app/api/mcp/test/route.ts (~20 schema, ~91-93 error return) — the two runtime MCP dialers; both do assertPublicUrl → resolveVaultSecret → connect.
- src/lib/types.ts McpServerConfig (~1142-1156).
- src/lib/store.ts addMcpServer/updateMcpServer payloads (~5530, ~5954) + the activity note it writes (~5472).
- src/lib/log-redact.ts redactSecrets/safeLog.
- src/lib/api/url.ts assertPublicUrl; src/lib/ai/vault-secret.ts resolveVaultSecret.
- src/components/settings/mcp-servers-panel.tsx.
- scripts/probe-tavily-mcp.mts (hand-assembles the key URL today — refactor it).

Build (exactly the v3 design):
1. types.ts: `export const AUTH_QUERY_PARAMS = ["tavilyApiKey"] as const;` `export type AuthQueryParam = (typeof AUTH_QUERY_PARAMS)[number];`. McpServerConfig gains optional `authStyle?: "bearer" | "query"` (default bearer) and `authQueryParam?: AuthQueryParam`. Existing bearer configs behave identically.
2. mcp-client.ts: one exported pure helper `applyMcpAuth(baseUrl, secret, opts?: {authStyle?: "bearer"|"query"; authQueryParam?: AuthQueryParam}): { url: string; token: string }`. bearer → {url: baseUrl, token: secret}. query → assemble via the URL API (append `authQueryParam=<secret>`, correctly handling an existing query string; encode the value) → {url: assembled, token: ""}. THROW if authStyle==="query" and (authQueryParam missing OR the baseUrl already contains that param, case-insensitive). Never log.
3. mcp-client + test route error hygiene: every error string references the HOST ONLY (new URL(url).host), never the full url. Return raw upstream error.message ONLY after passing it through redactSecrets, or reduce to host + status.
4. log-redact.ts: extend redactSecrets to strip, for each p in AUTH_QUERY_PARAMS, `[?&]p=<value>` → `p=REDACTED` (case-insensitive param match). Add a unit-covered helper if cleaner.
5. Base-url guard (fail at the boundary): in store addMcpServer/updateMcpServer AND both route zod schemas, reject a base `url` whose query contains any AUTH_QUERY_PARAMS entry (case-normalized) — BEFORE the activity note is written. zod: validate authQueryParam with z.enum(AUTH_QUERY_PARAMS); when authStyle==='query', authQueryParam is required.
6. Thread authStyle/authQueryParam through: store payloads → both route schemas → gatherMcpServers + test route pass them to applyMcpAuth. gatherMcpServers/test still assertPublicUrl on the BASE url (no key) first, then applyMcpAuth, then connect with the assembled url.
7. Settings UI (mcp-servers-panel.tsx): auth-style select (Bearer header | URL query param); when "query", a param select bound to AUTH_QUERY_PARAMS; the existing api-key picker supplies the secret (apiKeyId). Admin-only, minimal.
8. Refactor scripts/probe-tavily-mcp.mts to call applyMcpAuth (single assembly path; no hand-built key URL).
9. DNS-rebind: leave a single-line documented TODO at the tool-call redial (out of scope, pre-existing, all MCP servers).

Constraints: (what must NOT change) existing Bearer MCP servers behave identically; no new transport/deps; the key never persists outside the encrypted vault; assertPublicUrl always on the base (key-free) url; do not weaken or delete any existing test; keep it minimal — no speculative options, no dead code.

Proof: create tests/mcp-query-auth.mts (repo style). Assert: applyMcpAuth bearer → url unchanged, token=secret; query → url has authQueryParam=<encoded secret>, token=""; existing-query base appends with & not ?; value with URL-special chars encoded; applyMcpAuth THROWS when the base already contains the param and when authStyle query but param missing; redactSecrets turns `https://mcp.tavily.com/mcp/?tavilyApiKey=SEKRET` into `tavilyApiKey=REDACTED` and the raw secret never appears; the base-url save guard rejects a url containing tavilyApiKey; a simulated mcp-client/test error for a failing query-auth server contains the host but NOT the key. The Visionary also re-runs scripts/probe-tavily-mcp.mts (live) outside the sandbox. You need `npx tsc --noEmit` clean.

Stop when: enum + applyMcpAuth + redaction + base-url guard + schema threading + settings UI + probe refactor are in, tests/mcp-query-auth.mts encodes the above, `npx tsc --noEmit` clean. Do not delete, skip, weaken, or narrow tests to make the goal pass.

Report: give the tsc result. SHIP = built + tsc clean + test encodes the secret-safety assertions; REVISE = blocked/incomplete (why).
End with EXACTLY one line, nothing after it: VERDICT: SHIP or VERDICT: REVISE
