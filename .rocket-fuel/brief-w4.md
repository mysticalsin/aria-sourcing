You are the Integrator building Rock W4 of the approved Wave-2 plan (.rocket-fuel/PLAN-wave2.md, ROCKS-wave2.md) in the MSourcing repo. workspace-write. Config first, then route.

Objective: hiring needs originating in Databricks flow into the existing human-confirmed intake — a dedicated integration config + a hardened server route that executes a parameterized SQL Statement Execution query and returns PROPOSED intake drafts only.

Read first: (understand before editing)
- Verified API mechanics (docs.databricks.com, 2026-07): POST {host}/api/2.0/sql/statements, Bearer auth; body {statement, warehouse_id, wait_timeout:'30s', on_wait_timeout:'CONTINUE', disposition:'INLINE', format:'JSON_ARRAY', parameters:[{name,value,type}], row_limit}; if status.state PENDING/RUNNING poll GET /api/2.0/sql/statements/{id}; result.data_array strings + manifest.schema.columns. OAuth M2M: POST {host}/oidc/v1/token, HTTP Basic client_id:client_secret, body grant_type=client_credentials&scope=all-apis → {access_token, expires_in:3600}; cache ~55min. PAT = plain Bearer.
- src/lib/types.ts — SystemSettings (~1167: add databricks?: DatabricksSettings), API_KEY_PROVIDERS (~1019: add "Databricks").
- src/lib/providers.ts validateApiKeyFormat — add a Databricks case (PAT dapi... or OAuth secret; accept reasonable non-empty, reject junk).
- src/lib/sourcing/tavily.ts — the stored-key resolver pattern; make resolveStoredDatabricksSecret(session, apiKeyId) resolve by KEY ID (the config references a specific api_keys row), not provider-newest.
- src/lib/api/url.ts assertPublicUrl — the SSRF guard the host MUST pass before ANY fetch (token or statement). Private-link/internal workspaces are OUT OF SCOPE — document in the route header.
- src/app/api/source/route.ts — auth/RBAC/prodFailClosed/rate-limit route pattern to mirror.
- src/lib/mock-ai.ts parseEmailAndJD / ParsedIntake (~196-210) — the intake shape the UI confirms; src/app/intake/page.tsx (~239,328) — how proposals reach human confirmation.

Build:
1. types.ts: DatabricksSettings {host, warehouseId, authMode:'pat'|'m2m', clientId?, apiKeyId, needsQuery, sinceColumn?} on SystemSettings (optional). "Databricks" in API_KEY_PROVIDERS + validator case.
2. src/lib/integrations/databricks.ts (new, single responsibility): token acquisition (M2M with ≤55min in-memory cache keyed by host+clientId, or PAT passthrough), executeNeedsQuery(cfg, secret, {since}) — parameterized (:since TIMESTAMP), row_limit 500, INLINE JSON_ARRAY, PENDING→poll with capped backoff (≤5 polls), maps manifest.schema.columns+data_array to row objects, returns {rows} or a typed error. NO Supabase import here (mirror web-tools layering).
3. /api/integrations/databricks/needs route: prodFailClosed → session auth → RBAC 'source' → rate-limit → load DatabricksSettings from workspace settings → assertPublicUrl(host) (reject private/internal) → resolve secret via api_keys BY ID (service-role decrypt) → executeNeedsQuery → map each row through parseEmailAndJD (feed row fields as the email text: title/description/location/skills columns concatenated) → return {ok, proposals: ParsedIntake[]} ONLY. The server NEVER calls createCampaignFromAnalysis / mutates campaigns — human confirms in the intake UI.
4. Settings UI: minimal Databricks section in the integrations/settings panel consistent with existing key-entry patterns (host, warehouseId, authMode, clientId, api-key picker, needsQuery textarea). Admin-only.

Constraints: (what must NOT change) no auto-campaign creation; SSRF guard mandatory before any fetch; no secret ever returns to the browser; no new heavy dependencies (plain fetch); do not weaken or delete any existing test; keep web-tools/tavily layering intact.

Proof: create tests/databricks-intake.mts (repo style, stubbed global fetch — NO network). Assert: (a) a private/internal host (e.g. https://10.0.0.5 or metadata host) is REJECTED before any fetch; (b) M2M path sends Basic auth to /oidc/v1/token then Bearer to /api/2.0/sql/statements, and the token is cached across two calls (token endpoint hit once); (c) the statement body uses parameters[] (:since) — the raw since value never appears interpolated in the SQL string; (d) JSON_ARRAY rows map to proposals via parseEmailAndJD and a malformed row (wrong column count/nulls) is skipped without throwing; (e) PENDING first response → poll → SUCCEEDED works; (f) the route handler mutates NO campaign state (fixture asserts proposals returned, no store/DB write calls). The Visionary runs it outside the sandbox; you need `npx tsc --noEmit` clean.

Stop when: config type + provider entry + databricks.ts + route + settings UI exist, tests/databricks-intake.mts encodes (a)-(f), `npx tsc --noEmit` clean. Do not delete, skip, weaken, or narrow tests to make the goal pass.

Report: give the tsc result. SHIP = built + tsc clean + test encodes (a)-(f); REVISE = blocked/incomplete (why).
End with EXACTLY one line, nothing after it: VERDICT: SHIP or VERDICT: REVISE
