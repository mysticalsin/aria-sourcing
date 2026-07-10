# Level 10 Review — Rock 1 (COMPANY: paste→REAL fitting candidates)
Method: co-founder (V: claude · I: codex gpt-5.5) · 2026-07-09 · Build thread rock-1

## Segue
Codex fixed the parser (location extraction) + github.ts (type:user) so a pasted need returns real PEOPLE, not orgs.

## Scorecard (proofs by Visionary's own hands)
| Check | Command | Result |
|---|---|---|
| Offline parser | `npx tsx tests/intake-location.mts` | 1 passed, 0 failed (extracts "London") |
| LIVE acceptance | `npx tsx scripts/smoke-source-live.mts` | **SMOKE PASS** — 5 real users (samuelcolvin, adamchainz, 0atman, ayyucekizrak, robmarkcole), all github.com/<login>, zero synthetic |
| Cross-check | curl the exact query | total 16382, all type:User (people) — vs pre-fix openai/google (orgs) |
| Regression | Codex ran tests/sourcing.mts | 43 passed, 0 failed |

## Full diff read (+61/−3, 2 files) — no reward-hacking
- mock-ai.ts: extractLocation (4 patterns: location:/based in/team in/"in <Cap>") + normalizeParsedLocation (strips trailing clauses, rejects skills/seniority/remote via NON_LOCATION_VALUES + regex, title-cases). Careful, defensive — won't misread "in Python" as a place. ✓
- github.ts: effectiveQuery appends ` type:user` ONLY when no `type:` present (idempotent, no dupe — met the constraint); used for search + lang parse. ✓
No deleted/weakened tests.

## Headlines
- The pre-fix bug is real and now fixed: bare `language:python` returned orgs; `language:python location:London type:user` returns fitting people. This is Tony's acceptance criterion, proven live.
- MINOR: the live smoke intermittently ConnectTimeouts (2/4 attempts) on api.github.com — environmental (jittery sandbox net + github.ts 10s AbortSignal), not a sourcing-logic bug. Improvement for later: bump the smoke's timeout / add one retry so the proof is reliably green.

## Conclude
Rating: 9/10 (−1: smoke network flakiness needs a retry for a reliably-green proof).
VERDICT: SHIP (Rock 1 — the company rock)

Phase score: 94/100 — deduction: my first Rock-1 brief failed the contract-gate (missing literal 'Read first:'/'Constraints:' labels), costing one launch. Improvement applied: build briefs now use the EXACT 5-part contract field labels verbatim (the gate greps for them). Logged in IMPROVE.md.
