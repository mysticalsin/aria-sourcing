# Design — Tavily MCP for ARIA agents (query-auth MCP server support)
Owner ask (Tony): wire Tavily's hosted MCP server so ARIA agents can call its search/extract/research tools. Standard (explicit): clear for senior full-stack devs, enterprise-ready, well-structured, NO slop — small single-responsibility surface, reuse existing machinery, backward-compatible, secret-safe.

## Proven live (scripts/probe-tavily-mcp.mts, 2026-07-10)
The app's OWN mcp-client connects to https://mcp.tavily.com/mcp/?tavilyApiKey=<key>, completes initialize, lists 5 tools (tavily_search, tavily_extract, tavily_crawl, tavily_map, tavily_research), and tavily_search returns real linkedin.com/in results. Plumbing exists and works.

## The one real problem: Tavily MCP authenticates by URL QUERY, not Bearer header
Existing McpServerConfig assumes a Bearer token (apiKeyId → resolveVaultSecret → Authorization: Bearer). Tavily wants ?tavilyApiKey=<key>. The key is a SECRET and MUST NOT be persisted in McpServerConfig.url (that field is non-secret, saved in workspace JSON, shown in the settings UI, potentially logged). It must live only in the encrypted vault (api_keys, provider "Tavily" — already exists from the Rock-2 surface) and be injected server-side at connect time.

## Design (minimal, symmetric, backward-compatible)
1. types.ts — extend McpServerConfig with an OPTIONAL auth descriptor (default = today's behavior):
   `authStyle?: "bearer" | "query"` (default "bearer"); `authQueryParam?: string` (used only when authStyle === "query", e.g. "tavilyApiKey"). Existing configs (no authStyle) behave exactly as now.
2. mcp-client.ts — one exported pure helper, single responsibility:
   `applyMcpAuth(baseUrl: string, secret: string, opts?: {authStyle?: "bearer"|"query"; authQueryParam?: string}): { url: string; token: string }`
   - "bearer" (default): { url: baseUrl, token: secret }
   - "query": { url: baseUrl with `?<authQueryParam>=<encodeURIComponent(secret)>` appended via URL API, token: "" }
   Never logs. The key-bearing URL is returned for immediate use, never stored.
3. Both call sites resolve identically (DRY): src/app/api/hermes/chat/route.ts gatherMcpServers + src/app/api/mcp/test/route.ts:
   - assertPublicUrl(BASE url) — SSRF guard runs on the CLEAN base (no key) — mcp.tavily.com is public.
   - secret = apiKeyId ? resolveVaultSecret(apiKeyId) : ""
   - { url, token } = applyMcpAuth(baseUrl, secret, {authStyle, authQueryParam})
   - connectAndListTools(url, token) / callMcpTool(url, token, ...)
   The ResolvedMcpServer carries the assembled url + token for the loop (tool-loop callMcpTool already takes url+token — unchanged).
4. Secret hygiene: ensure the assembled query-key URL is never emitted by mcp-client error strings or safeLog. mcp-client errors reference the host only, never the full URL; add a redaction if any path includes the URL.
5. Settings UI (mcp-servers-panel.tsx): add an auth-style selector (Bearer header | URL query param) + query-param-name field shown only for "query"; the api-key picker already exists. Admin-only, unchanged otherwise.
6. Register Tavily: the user stores their Tavily key via the existing encrypted API-keys panel (provider "Tavily"), then adds an MCP server {name: "Tavily", url: "https://mcp.tavily.com/mcp/", authStyle: "query", authQueryParam: "tavilyApiKey", apiKeyId: <that key>}. ARIA agents then see tavily_* tools through the existing gatherMcpServers path — zero change to the agent loop.

## Non-goals
No change to the REST sourcing path (already live). No new transport (reuse mcp-client Streamable-HTTP). No storing the key in any non-vault field. Not adding Tavily tools to non-agent surfaces.

## Proof
tests/mcp-query-auth.mts: applyMcpAuth bearer returns {url unchanged, token=secret}; query returns {url with ?tavilyApiKey=<encoded>, token=""}; query with a key containing URL-special chars is correctly encoded; a base url that already has a query string appends correctly (& not ?); assertPublicUrl is called on the base (not key-bearing) url — a private base host is rejected before any key is applied; the key never appears in an error/log string on failure. Live proof retained: scripts/probe-tavily-mcp.mts (network, not gate).

## Sequencing
Security-sensitive (secret handling) → design meeting (Codex attack) → build → Level 10 → adversarial verify on secret-leak paths before SHIP.

---
## v2 — after meeting round 1 (all 3 blockers + risks accepted, none rebutted)
Additions that make it actually secret-safe + enterprise-clean:

B1 — Base URL must never hold the secret. Validate on SAVE (store action + both route zod schemas + settings UI): reject a base `url` whose query contains the configured `authQueryParam` (or any known auth param). `applyMcpAuth` also THROWS if the base already contains `authQueryParam` (nit). The persisted McpServerConfig.url is always key-free; activity notes (store.ts:5472) never see a key.

B2 — Thread the auth fields end to end (or they never reach runtime): McpServerConfig gains authStyle/authQueryParam (types.ts); the store payloads (store.ts:5530, :5954) and BOTH route zod schemas (hermes/chat:63, mcp/test:20) accept + forward them; gatherMcpServers + test route pass them to applyMcpAuth.

B3 — Centralized query-secret redaction. Extend redactSecrets/safeLog to strip `[?&]<param>=<value>` for known auth query params (tavilyApiKey + a small set) → `<param>=REDACTED`. mcp-client errors and /api/mcp/test responses reference the HOST only (new: derive host via new URL(url).host, never echo the full url); chat tool-loop failure logs run through the redactor. Net: the key cannot appear in any error string, log, or UI message.

Risk (DNS rebind on tool-call redial, hermes/chat:143 + tool-loop:55) — PRE-EXISTING and applies to ALL MCP servers, not introduced here. OUT OF SCOPE for this rock; documented as a known limitation + logged TODO (address in a Wave-3 MCP hardening: pin the validated IP or re-guard per call). Not silently ignored.

Q (probe script is a 3rd dialer) — scripts/probe-tavily-mcp.mts refactored to call applyMcpAuth too, so URL assembly has ONE path everywhere (no hand-assembly).

## Proof v2 (additions)
tests/mcp-query-auth.mts also asserts: a base url containing the authQueryParam is REJECTED (save-time validator + applyMcpAuth throws); redactSecrets turns `...?tavilyApiKey=SECRET` into `tavilyApiKey=REDACTED` and never emits the raw key; an mcp-client/test error for a failing query-auth server contains the host but NOT the key.

---
## v3 — after round 2 (1 blocker + 1 risk accepted, none rebutted)
B3-tight — authQueryParam is a closed ENUM, single source of truth for redaction:
  `export const AUTH_QUERY_PARAMS = ["tavilyApiKey"] as const;` `type AuthQueryParam = typeof AUTH_QUERY_PARAMS[number];`
McpServerConfig.authQueryParam: AuthQueryParam (not arbitrary string). The redactor (redactSecrets/safeLog) iterates AUTH_QUERY_PARAMS to strip `[?&]<param>=<value>` → REDACTED. Guarantee: every configurable auth param is, by construction, a redactable one — a param the UI can set is a param the redactor covers. Adding a future query-auth MCP server = add its param to AUTH_QUERY_PARAMS in ONE place; redaction + validation follow automatically. Both route schemas validate authQueryParam against the enum (zod enum), so an arbitrary/unknown param is rejected at the boundary.

B1-timing — the base-url auth-param guard is case-normalized (lowercased param compare) and runs BEFORE addMcpServer constructs the activity entry (store.ts:5472), so a rejected url never reaches the activity log.
