# Is This the Best We Can Do? — Sourcing Critique, 2026-07-16

Method: 3 deep readers (client pipeline internals, learning/agentic truth, recruiter journey)
+ 4 independent adversarial critics (operator, data, automation, moat lenses), all evidence-cited.
Frame: industrial-grade enterprise sourcing. Full agent outputs in the session workflow journal
(wf_2e4f81fc-283).

## Verdict

**No — and all four critics independently converged on the same root cause.**
ARIA today is an excellently-governed compliance chassis wrapped around a demo-grade engine.
The governance spine (RLS tenancy, SECURITY DEFINER authorities, GDPR erasure across 15 stores,
consent passports, provenance, DB-enforced never-auto-send, discrimination filters) is genuinely
rare — competitors are business-model-incapable of copying it. But the engine underneath cannot
yet be a recruiter's daily driver at industrial scale, and every ceiling traces to two decisions:

1. **The browser is the runtime.** map→score→dedupe already run server-side, but the ONLY path
   that persists a candidate (`commit`/`commitPersisted`) is a React useCallback closing over
   component refs (store.ts:779-874). Nothing can source while you sleep. Async providers die
   when the tab closes. Proven live in this session's E2E: a verified raw Apify match for a real
   person could not become a scored candidate without a mounted browser.
2. **The corpus is a blob.** Every candidate for the org lives in one `workspace_state.state`
   JSONB document — no table, no indexes, no embeddings, no person entity, whole-document
   last-write-wins saves on a 600ms debounce. Two recruiters editing unrelated campaigns can
   silently destroy each other's edits. The compounding asset can't compound.

## The convergent ceilings (deduped across critics, ranked by leverage)

| # | Ceiling | Leverage | Effort | Lens votes |
|---|---------|----------|--------|-----------|
| 1 | No server-side commit path — browser-bound pipeline | 10/10 | L | operator 9, automation 10 |
| 2 | JSONB blob corpus — no table/index/embeddings, LWW clobbering | 10/10 | L | data 10, operator 9, moat 6 |
| 3 | Vivier can't feed a new campaign — the rebenching engine (THE Mantu-shaped moat) is a dead-end re-contact list; cross-campaign dedupe permanently traps a person in their first campaign | 9/10 | M-L | moat 9, data 7, operator 8 |
| 4 | Compliance moat is UNPROVABLE — audit attribution is a shared free-text `operatorName`, not the authenticated user; no exportable DPA/client dossier | 9/10 | L | moat 9 |
| 5 | No identity resolution — exact-string reject-only dedupe, no person entity, no canonicalization; cross-provider duplicates permanent | 9/10 | L | data 9 |
| 6 | No durable jobs on Fly — no recurring searches, no background enrichment, no webhook refresh; only scheduler is a daily Vercel cron | 9/10 | L | automation 9 |
| 7 | Paid enrichment DISCARDS experience/education/languages (billed, provenance-stamped, thrown away — no Candidate slot); 22% experience dimension flat-50, 10% activity dimension flat-62 (demo regex) → ~⅓ of the shortlist score is noise | 8/10 | **S-M** | all four (7-8) |
| 8 | Agent loop can't call Apollo/Apify — the two providers that return contactable people; framework runs forced deterministic | 8/10 | M | automation 8 |
| 9 | Learning loop is open — no reply/interview/hire outcome ever feeds scoring or queries; 3 manual CLI scripts + two-person rule with zero automated callers; promoted lessons only re-rank existing GitHub queries | 7/10 | M-L | automation 7, moat 7 |
| 10 | Operator friction bundle: no campaign-scoped bulk actions, no saved/re-runnable searches, no alerts/digest, no campaign rename, no table virtualization, dead statuses (Interviewing/Closing unreachable) | 6-8/10 | S-M | operator |
| 11 | Enrichment budget ledger lives in the client — spend discipline enforceable by DevTools | 7/10 | M | moat 7, automation |

## Notable single findings

- Client re-scoring throws away the server's identical score (redundant divergence risk).
- Sillage/Seamless/Apify commits use a weaker unguarded commit path than Apollo/GitHub.
- An orphaned server-side screening state machine already exists (src/lib/agents/graph.ts).
- "Agent-framework-triggered sourcing" never touches an LLM (forced deterministic, one query).

## What must NOT be broken (unanimous)

- Never-auto-send (DB-enforced approval) — the trust anchor.
- RLS tenancy + SECURITY DEFINER authority pattern — the substrate all fixes should ride.
- GDPR erasure 0033 (fail-closed, tombstones, reimport-guard) — EXTEND to new tables, never bypass.
- LinkedIn assisted-manual policy; consent passports; provenance; discrimination-proxy filter.
- Deterministic auditable scoring (fix its dead dimensions; don't replace with a black box).

## Build order (industrial lens)

**Quick wins first (S-M, this week):**
- W1. Home experience/education/languages on Candidate; derive yearsExperience; re-score.
  Highest quality-per-effort in the whole report — un-deadens 22% of the score and stops
  paying for discarded data.
- W2. Fix or renormalize the activity dimension (real provider signals, or zero-weight + renorm).
- W3. Campaign-scoped bulk actions + campaign filter on /candidates + table virtualization.
- W4. SavedSearch entity + re-run button (schema-ready for scheduling later).

**Phase 1 — corpus (the unlock):** normalized `candidates` table (+RLS, + erasure-authority
extension), dual-write migration off the blob, row-level writes. Data critic supplied the safe
sequence: tables → dual-write → extend 0033 → cut reads → retire blob-candidates.

**Phase 2 — runtime:** server commit RPC (`commit_sourced_candidates`, optimistic-concurrency,
fingerprint re-check in-transaction) + durable jobs table + Fly worker (recurring searches,
provider polls, background enrichment, budget authority server-side). "Sources while you sleep,
safely" becomes true — drafts still stop at the approval gate.

**Phase 3 — person model + Vivier engine:** `persons` + `candidate_identities` (canonicalized)
+ `candidacies` (person×campaign, N over time). Dedupe becomes suggest-don't-block across
campaigns. "Match from Vivier → assign to campaign" with lineage + reused consent. This is the
rebenching flywheel — the single most Mantu-shaped feature.

**Phase 4 — provable compliance:** thread auth.uid() into every attributable mutation
(reveal/approve/consent ledgers), exportable compliance dossier endpoint per candidate/campaign.
Turns the half-built moat into a sales artifact LinkedIn/Apollo structurally cannot match.

**Phase 5 — closed learning loop + wider agent reach:** outcome-driven scoring-weight PROPOSALS
(bounded, per-campaign, human-approved via the existing two-person lesson gate); register
Apollo/Apify as agent tools under the existing receipt authority + query filters. pgvector
embeddings + "more like this hire" similarity search land here on the Phase-1 table.

## Bottom line

The moat is real but half-built, and it is NOT "more AI" — it is (a) a consented talent pool
that compounds into a redeployment engine, and (b) provable lawful process. Both are data-model
problems, not model problems. The spine is enterprise-grade today; the engine becomes industrial
when the corpus leaves the blob and the pipeline leaves the browser.
