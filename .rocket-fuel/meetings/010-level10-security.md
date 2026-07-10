# Level 10 Review — Security Layer (candidate-facing disclosure + injection)
Method: co-founder (V: claude · I: codex gpt-5.5) · 2026-07-10 · Build thread security

## Segue
Codex built agent-disclosure-policy.ts (whitelist + shared sink scan + salary allowlist + injection triage) and rewired 10 files (whatsapp-inbound, agents/graph, agents/run, sourcing-agent, store.ts, autopilot, approve, send, whatsapp-review, dispatch).

## Scorecard (proofs by Visionary's own hands)
| Check | Command | Result |
|---|---|---|
| Type safety | `npx tsc --noEmit` | PASS |
| Policy proof | `npx tsx tests/agent-disclosure-policy.mts` | 64 passed, 0 failed |
| Leak drift grep | grep JSON.stringify(brief/state.brief)/roleSummary in candidate-facing src | ZERO — all closed |
| Whitelist wired | whatsapp-inbound:204, graph.ts:127,181 | route through candidateDisclosureContextForCampaignLike ✓ |
| Guardrail | linkedin-policy / outreach-guardrails / dispatch-outbound | 18/42/79, 0 failed |

## REGRESSION caught + fixed (this is why the Visionary runs proofs)
- Initial run: **autopilot 47 passed, 2 FAILED** ("salary commitment queues", "offer commitment queues").
- Root cause: Codex folded COMMITMENT_PATTERNS into validateCandidateBoundText but returned a generic reason 'disclosure-leak-blocked' — the tests + downstream expect the specific 'commitment-salary'/'commitment-offer'/'commitment-contract' tag.
- Fix (Visionary, at source — the security module under active build, preserving the broken contract, not an end-run): `for (const [pattern, tag] of COMMITMENT_PATTERNS) ... return { reason: tag }`.
- Re-run: **autopilot 49/0, agent-disclosure-policy 64/0, tsc clean.**

## Full diff read (reward-hacking)
No deleted/weakened tests. COMMITMENT_PATTERNS behavior subsumed, not removed (tag preserved). Whitelist is default-DENY on the real JobAnalysis shape. Sinks call the shared scan.

## Headlines
- The confirmed live leak (whatsapp-inbound.ts:200 JSON.stringify(brief)) is CLOSED — plus 4 more leak sources Codex+meeting found.
- PENDING: 4-lens adversarial verify running (leak-completeness, injection-bypass, salary-inference, correctness-modify). SHIP is NOT declared until that returns clean. Security gets the verify BEFORE SHIP, not a single review.

## Conclude (provisional — pending verify)
Rating: 8/10 (−2: a reason-string regression shipped that the offline gate caught only because the Visionary ran it; Codex's in-sandbox self-check couldn't run tsx).
VERDICT: HOLD FOR VERIFY (not SHIP yet)

Phase score: 91/100 — the Visionary proof-run caught a real regression Codex's report called DONE. Improvement: security-critical rocks ALWAYS get (a) Visionary offline proof-run AND (b) 3-lens verify before SHIP — never trust ROCK-STATUS: DONE alone. (Already in IMPROVE.md.)
