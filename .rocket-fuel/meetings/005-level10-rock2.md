# Level 10 Review — Rock 2 (safe Tavily key surface + full chokepoint)
Method: co-founder (V: claude · I: codex gpt-5.5) · Build thread 019f49fd-… · 2026-07-09

## Segue
Codex built the encrypted Tavily key surface + threaded the key through every web_search path + set DATA_ENCRYPTION_KEY. It reported BLOCKED only because `npx tsx` can't start in its workspace-write sandbox (Unix-socket listen EPERM) — a sandbox limitation, not a build failure. Per protocol the Visionary runs the proof regardless.

## Scorecard (proofs run by Visionary's own hands — Codex's pasted output not counted)
| Check | Command | Result |
|---|---|---|
| Rock 2 proof | `npx tsx tests/web-tavily-key.mts` | **10 passed, 0 failed** |
| Type safety | `npx tsc --noEmit` | No errors |
| web-tools Supabase-free (R2) | grep supabase in web-tools.ts | CLEAN (no import) |
| Guardrail intact | `npx tsx tests/linkedin-policy.mts` | 18 passed, 0 failed |
| Guardrail intact | `npx tsx tests/outreach-guardrails.mts` | 42 passed, 0 failed |

## Full diff read (reward-hacking check) — 10 files, +37/−13, surgical
- web-tools.ts: webSearch(query, storedTavilyKey?) → `stored ?? env`; runWebTool opts.tavilyKey. Backward-compatible. Supabase-free. ✓
- tool-loop.ts: ResolvedMcpServer.tavilyKey + execTool passes it to the BUILTIN_WEB branch. ✓
- sourcing-tools.ts: makeSourcingToolRunner gains tavilyKey param (beside githubToken), passes to runWebTool. ✓ (the 7th path)
- 4 routes: resolve resolveStoredTavilyKey(session) and pass it. ✓
- crypto-secrets.ts: encryptionRequiredButMissing hardened → true for (prod OR live-Supabase) && !demo && !keySet; preserves the demo escape hatch; reads env directly (kills a circular import). ✓
- providers.ts: Tavily validator /^tvly-[A-Za-z0-9_-]{8,}$/. ✓
- tavily.ts (new): faithful mirror of resolveStoredApolloKey, workspace-scoped, service-role, provider="Tavily". ✓
- tests/web-tavily-key.mts (new): REAL — stubs api.tavily.com fetch, asserts the STORED key is what reaches Tavily via BOTH source-route and sourcing-runner paths (seenKeys.at(-1)===secret) with env unset; env fallback; validator; encryption fail-closed. Not gamed. ✓
No deleted/weakened tests. No swallowed errors.

## Headlines (beyond the rock)
- CONFIG NOTE for Owner: DATA_ENCRYPTION_KEY was set in .env.local (dev). The LIVE container (:3003) still lacks it — to save a Tavily key safely ON :3003, the container env needs DATA_ENCRYPTION_KEY too. Flagged for the deploy wave; code is correct.

## Conclude
Rating: 9/10 (−1: Codex couldn't self-run the proof due to the tsx-sandbox trap; caught + logged). 
VERDICT: SHIP (Rock 2)

Phase score: 93/100 — deduction: the tsx-in-sandbox limitation should have been anticipated in the build brief (proof command uses tsx, which the sandbox blocks). Improvement applied: build briefs now state "the Visionary runs the tsx proof outside the sandbox; Codex need only build + tsc-check" + logged as trap 14. Every future rock proof is a Visionary-hands proof by default.
