You are the Integrator building Rock 2 of an approved plan in the MSourcing/ARIA Next.js repo. Build EXACTLY this, nothing more. You have workspace-write. Do not delete, skip, weaken, or narrow any existing test to make the goal pass.

## Objective
Add a SAFE, encrypted "Tavily" search-API-key surface, and thread that stored key through EVERY web_search path so a key added in the app (not just an env var) is actually used for sourcing.

## Read first (understand before editing)
- src/lib/ai/web-tools.ts — runWebTool (~line 284), webSearch (~193, reads process.env.TAVILY_API_KEY at ~198), tavilySearch (~168). Keep this file Supabase-FREE (it is SSRF-pure; do not import any Supabase client here).
- src/lib/ai/tool-loop.ts — execTool (~line 50): dispatches server.run first, then BUILTIN_WEB_URL → runWebTool. runAnthropicWithTools / runOpenAiWithTools build the loop.
- src/lib/ai/sourcing-tools.ts — makeSourcingToolRunner(campaign, existing, weights, githubToken) (~76); its run() calls runWebTool("web_search",{query}) directly (~110). This runner is dispatched as server.run BEFORE the BUILTIN_WEB branch — it must thread the key too.
- src/lib/sourcing/apollo.ts:197-214 — resolveStoredApolloKey(session): the EXACT pattern to mirror (workspace-scoped, service-role decrypt from api_keys).
- src/lib/crypto-secrets.ts — encryptSecret (~51, returns plaintext when DATA_ENCRYPTION_KEY unset), encryptionRequiredButMissing (~47, currently isProduction && !demoLoginEnabled && !secretEncryptionEnabled).
- src/app/api/keys/route.ts — how keys are saved encrypted (admin-RLS, last4).
- src/lib/types.ts:1017 API_KEY_PROVIDERS (already has Apollo, Seamless, Sillage; Tavily is MISSING).
- src/lib/providers.ts — validateApiKeyFormat (add a Tavily case).
- Callers that have a Supabase session and reach web_search: src/app/api/source/route.ts (~119 direct runWebTool), src/app/api/sourcing-agent/route.ts (~142, builds makeSourcingToolRunner), src/app/api/agents/run/route.ts (~87), src/app/api/hermes/chat/route.ts (~255).
- tests/dispatch-outbound.mts + the fake-Supabase harness proven in commit a87fed7 — reuse this harness pattern for the new test.

## Build
1. Add "Tavily" to API_KEY_PROVIDERS (types.ts) and a Tavily format validator case in providers.ts (Tavily keys look like `tvly-...`; accept a reasonable non-empty format, reject obvious junk).
2. Add resolveStoredTavilyKey(session) in a suitable module (mirror resolveStoredApolloKey exactly; provider string "Tavily").
3. Thread an optional tavily key WITHOUT importing Supabase into web-tools.ts:
   - runWebTool(name, args, opts?: { tavilyKey?: string }) → webSearch(query, tavilyKey?) → use `tavilyKey ?? process.env.TAVILY_API_KEY`.
   - tool-loop execTool: pass a tavilyKey (carried on the loop context / runner args) into the BUILTIN_WEB_URL runWebTool call.
   - makeSourcingToolRunner: add a tavilyKey param (beside githubToken) and pass it to its runWebTool call.
   - In the 4 session-bearing routes above, resolve resolveStoredTavilyKey(session) once and pass it into whichever runner/loop that route builds. Default (no key) MUST preserve current env→DuckDuckGo behavior (backward-compatible).
4. Safe storage: harden encryptionRequiredButMissing so a real-data (Supabase-enabled, non-demo) workspace refuses a plaintext secret write even outside production. Do NOT break the public-demo escape hatch. Also set DATA_ENCRYPTION_KEY in .env.local if absent: generate a 32-byte base64 value and add `DATA_ENCRYPTION_KEY=<value>` (this makes encryptSecret actually encrypt locally). Do not print the value.

## Constraints (must NOT change)
- web-tools.ts stays Supabase-free.
- Do not weaken/delete any existing test. tests/linkedin-policy.mts, tests/outreach-guardrails.mts, tests/dispatch-outbound.mts must still pass unchanged.
- No new network calls in the offline test. No bypass of RBAC/auth on the routes.
- Backward compatible: absent key → env → DuckDuckGo, exactly as today.

## Proof (create this test file, then run it)
Create tests/web-tavily-key.mts (reuse the fake-Supabase harness). It must assert, offline/deterministically:
- encryptSecret round-trips a value when a key is set;
- resolveStoredTavilyKey returns the decrypted workspace key from a stubbed api_keys row;
- with process.env.TAVILY_API_KEY UNSET, a stored key reaches webSearch through BOTH the source-route path AND the makeSourcingToolRunner path (stub the actual Tavily HTTP call; assert the key value that webSearch would use);
- env fallback still works when no stored key;
- the Tavily validator rejects an obviously-invalid key;
- encryptionRequiredButMissing() returns true for a real-data workspace with no DATA_ENCRYPTION_KEY.
Run: `npx tsx tests/web-tavily-key.mts` → must print a passed/0-failed line and exit 0.
Also confirm no regression: `npx tsc --noEmit` exits 0.

## Report
End your report with the proof command's verbatim output and, on the final line alone, exactly one of:
ROCK-STATUS: DONE
ROCK-STATUS: BLOCKED <one-line reason>
