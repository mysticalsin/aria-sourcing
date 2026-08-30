---
project: MSourcing / ARIA
shift: 440
agent: cursor-cloud
updated: 2026-08-30T19:04Z
status: branch-pushed-pr53-closed-needs-reopen
---

# Handoff — Shift 440

## Current state

- **FF tip:** `main` @ `1847c79`.
- **This shift branch:** `cursor/sourcing-quality-contact-track-b91d` @ `ef2fc9f`.
- **PR #53:** still CLOSED. Agent cannot reopen/edit (403). Parent must `gh pr reopen 53` — **do not open a second PR**.
- Gate green locally: `npm run typecheck && npm run typecheck:tests && npm test`.
- **scoring-quality:** 92 pass. Full application gate green.
- **Fly:** ready green at build `d9e8cd0` — **not** this tip. No deploy of `ef2fc9f` while PR closed.

## Done this shift

1. **Hard gates** (`src/lib/sourcing/hard-gates.ts`): majority must-have miss / zero hits, verifiable language miss, impossible Europe geo (with concrete JD-city override), known years outside band → cannot enter shortlist. `eligibleForShortlist` = gates + floor 80.
2. **JSON brief ingest** (`src/lib/needs/brief-json.ts`): `consulting_recruitment` / flat JSON → JobAnalysis (`mandatory_requirements`, `screening_criteria`, `boolean_search`). Intake button + `parseEmailAndJD` detects JSON paste. Fixtures: `CALYPSO_BA_CONSULTING_RECRUITMENT_JSON`, `TS_EUROPE_CONSULTING_RECRUITMENT_JSON`.
3. **Match evidence** on Candidate + `MatchEvidencePanel` in candidate drawer (must-have hit/miss, languages, geo, seniority, OTW, hard-gate reasons).
4. **Open to Work boost** folded into dimension contributions (Σ breakdown === score); Apify `openToWork` mapped.
5. **Cross-provider dedupe**: LinkedIn/GitHub URL normalize, externalIds, name+company fingerprint; contact/DNC before shortlist.
6. **Query builder** (`src/lib/sourcing/query-builder.ts`): explicit `searchBoolean` or synthesize from must-haves + titles + geo; drives LinkedIn/GitHub strategy.
7. Synth candidates clear gates (all must-haves, years clamped, Europe/target geo, languages).
8. Overflow fix + contact badges preserved; Montreal + Europe geo logic preserved.

## Blockers

- PR #53 closed + reopen/edit 403. Parent:
  ```bash
  gh pr reopen 53
  gh pr edit 53 --title "Sourcing: hard gates, JSON brief, evidence, query builder, contact track"
  # then merge → Fly deploy tip ef2fc9f
  ```
- Graph/Microsoft/HeyReach = HOLD.

## Next steps

```bash
gh pr reopen 53
# After merge:
flyctl deploy -a aria-mantu-app   # tip ef2fc9f
curl -s https://aria-mantu-app.fly.dev/api/ready
# E2E: SAMPLE_CALYPSO_BA_NEED + SAMPLE_TS_EUROPE_NEED + Calypso JSON brief
```

## Decisions made (don't relitigate)

- main is FF tip over integration for this work.
- Do not restore deleted orchestrator/providers megapr; surgical scoring port only.
- Do not chase Entra/Graph.
- Contacted skip reason preferred over generic Duplicate when identity was already contacted.
- Calypso remains one golden fixture; quality bar need-agnostic (second golden = TS Europe).
- Shortlist top-K clamped 5–20.
- Hard gates: majority must-have threshold (all when ≤2); concrete JD city overrides macro-EU far-geo reject.
- Do **not** open a second PR — reopen #53.

## Watch out

- Live mapper fixtures must clear must-haves or they are skipped (not accepted empty).
- `test-manifest-contract` freezes must be refreshed when adding suites.
- Cherry-picking full `scoring-quality-upgrade-b91d` still conflicts (orchestrator deleted on main).
