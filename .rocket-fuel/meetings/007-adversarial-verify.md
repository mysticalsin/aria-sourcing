# Adversarial Verify + Level 10 — Rocks 1/2/3 (3-lens fresh-eyes audit)
Method: 3 independent lens-agents (security · correctness · guardrails) attacked the applied diffs, beyond the Visionary's own Level-10. This is the "is this the best?" pass — and it found defects the single-pass review missed.

## Rock 3 (honesty) — Level 10: SHIP
- Proof by Visionary hands: `tests/integrations-honesty.mts` 6/6; `tests/dispatch-outbound.mts` 79/79 (no regression). tsc clean.
- Precise check: 0 cards with (real:false AND status:'connected'). D6 "3 still connected" was a Visionary grep false-alarm (window bled into real:true cards). Clean.

## Confirmed defects in Rocks 1+2 (→ fix pass brief-fix1.md)
| ID | Sev | Defect | Fix |
|---|---|---|---|
| D1 | major | /api/hermes/chat resolves+attaches the stored Tavily key for ANY authenticated member incl. read-only viewer (task='chat' not in TASK_PERM; webResearch push unconditional). A viewer denied by /api/source can spend the admin's paid key via chat. | gate on `can(role,'source')` before resolving the key |
| D2 | major | resolveStoredTavilyKey returns "" (not null) on decrypt failure → `"" ?? env` shadows the env key → silent degrade to DuckDuckGo across all paths | `return key || null` |
| D3 | major | githubLocationQualifier returns unquoted ` location:New York` → GitHub mis-parses multi-word cities (London worked only as single word) | quote: `location:"${city}"` (store.ts + smoke) |
| D4 | minor | new tests (web-tavily-key, intake-location, integrations-honesty) not in the npm test chain → gate never runs them | add to package.json test chain |
| D5 | minor | undici@^6.27.0 added to deps, imported nowhere (Visionary added it for SSRF pinning, never used) | remove from package.json |
| D7 | minor | crypto-secrets docstring + .env.local.example still say DATA_ENCRYPTION_KEY "optional/plaintext" though it's now required for live-Supabase | doc update |

## Why this matters (Kaizen)
The Visionary's single-pass Level 10 passed Rocks 1+2 as SHIP. The 3-lens adversarial verify (independent, role-specialized, prompted to REFUTE) caught 3 majors + 2 minors the single pass missed — a viewer-spends-paid-key RBAC hole, a fallback-shadowing bug, and a multi-word-city query break. Improvement applied to IMPROVE.md: every rock touching auth/secrets/query-construction gets a 3-lens adversarial verify BEFORE its Level-10 SHIP, not a single review.
Phase score: 90/100 — the process caught its own blind spot; deduction for needing a fix cycle that a pre-verify would have folded into the first build.
