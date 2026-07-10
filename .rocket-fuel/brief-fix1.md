You are the Integrator applying a Level-10 FIX PASS to the MSourcing/ARIA repo. workspace-write. A 3-lens adversarial review + Visionary review confirmed 5 real defects in the just-built Tavily-key + location work. Fix EXACTLY these, nothing else.

Objective: close 5 confirmed defects (RBAC key-spend gap, decrypt-failure key shadowing, multi-word city query breakage, tests not in the gate, dead dependency) without changing any other behavior.

Read first: (understand before editing)
- src/app/api/hermes/chat/route.ts (~199-260): TASK_PERM has {outreach, sourcing, classify} but NOT 'chat'; when webResearch is true it pushes the BUILTIN_WEB tool with the resolved Tavily key for ANY authenticated member incl. a read-only viewer. Contrast src/app/api/source/route.ts:81-84 which gates `can(role, "source")` BEFORE resolveStoredTavilyKey. src/lib/rbac.ts for the permission model (viewer = ["view"]).
- src/lib/sourcing/tavily.ts:27 — `return decryptSecret(row.secret);` returns "" (not null) on decrypt failure; callers use `?? undefined` and webSearch uses `storedTavilyKey ?? process.env.TAVILY_API_KEY`, so "" shadows the env key and silently drops Tavily.
- src/lib/store.ts:757 githubLocationQualifier — returns ` location:${city}` UNQUOTED, so `location:New York` is mis-parsed by GitHub (only single-word cities work).
- package.json:18-19 — the test chain (chained `&&` of `tsx tests/*.mts`). New tests tests/web-tavily-key.mts, tests/intake-location.mts, tests/integrations-honesty.mts are NOT in it. package.json:42 — `undici` dependency is imported nowhere in src/tests/scripts.

Build (exactly these 5 fixes):
1. D1 RBAC: in hermes/chat, only resolve+attach the Tavily web_research key when the caller has the 'source' permission (mirror source route's `can(role, "source")`). A viewer/non-source role must NOT get the paid key attached — fall back to env/keyless like an unconfigured workspace. Do not otherwise change chat behavior.
2. D2: src/lib/sourcing/tavily.ts — `const key = decryptSecret(row.secret); return key || null;` so a decrypt failure returns null and the env-key fallback works. (Do the same guard only here; do not touch apollo/sillage/seamless.)
3. D3: githubLocationQualifier (store.ts) — quote multi-word cities: return ` location:"${city}"` (GitHub search requires quotes for multi-word qualifier values). Update scripts/smoke-source-live.mts's query builder the same way. Single-word cities must still work.
4. D4: add the three new tests to the package.json test chain so `npm test` runs them.
5. D5: remove `undici` from package.json dependencies and run the package manager to update the lockfile (it is imported nowhere).

Constraints: (what must NOT change) do not alter the SSRF guard, LinkedIn wire-enforcement, or outreach guardrails. Do not change scopes/auth beyond the D1 gate. Do not weaken or delete any existing test. Keep web-tools.ts Supabase-free.

Proof: the Visionary re-runs these outside the sandbox (tsx IPC EPERM in-sandbox is expected — you only need `npx tsc --noEmit` clean): `npx tsx tests/web-tavily-key.mts`, `npx tsx tests/intake-location.mts`, `npx tsx tests/integrations-honesty.mts`, `npx tsx tests/linkedin-policy.mts`, `npx tsx tests/dispatch-outbound.mts`. Add ONE assertion to tests/web-tavily-key.mts proving D2 (a stored row whose decrypt fails → resolveStoredTavilyKey returns null → env key is used).

Stop when: all 5 fixes are in, `npx tsc --noEmit` is clean, and the D2 assertion exists. Do not delete, skip, weaken, or narrow tests to make the goal pass.

Report: end with the tsc result and, on the final line alone, exactly one of:
ROCK-STATUS: DONE
ROCK-STATUS: BLOCKED <one-line reason>
