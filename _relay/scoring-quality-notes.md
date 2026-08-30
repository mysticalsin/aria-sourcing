# Scoring quality upgrade — notes for SMART + operators

**Branch:** `cursor/scoring-quality-upgrade-b91d`  
**Owner:** scoring/ranking quality (this agent). SMART HTTP pull/push is a sibling agent.

## What changed

1. **Must-have skills dominate** — skills weight 40; required:nice = 92:8. Missing most must-haves caps skills hard; title-overlap cannot invent must-have coverage.
2. **Domain signals** — CIB / settlements / back office / MOA / Calypso / capital markets inferred from `profileText` + `domainTags` + JD mission/skills; folded into industry dimension with explicit rationales.
3. **Seniority band** — years scored only when `yearsExperience` is provided (never fabricated). Mid-band (e.g. 7–10) preferred over bare minimum.
4. **Language** — only when `JobAnalysis.requiredLanguages` is set (VSS Language Must → mock-ai fills this). Blended into location dimension.
5. **Montreal / remote** — geo match + Montreal signal when JD targets Montreal.
6. **Weak/generic resumes** — dampened; **synthetic** provenance ×0.92 (no demo inflation).
7. **Ranking** — `rankScoredCandidates` / `selectTopKByMatchScore`: score **full** set → sort by quality → top-K. Volume is not the limiter.

`minScoreToContact` / `SOURCING_QUALITY_FLOOR` remain **80**.

## SMART mapper — populate these additive optional fields

| Field | On | Purpose |
|---|---|---|
| `profileText` | Candidate | Full resume / SMART OCR / Cvtheque body for skill+domain+language matching |
| `domainTags` | Candidate | Structured tags e.g. `CIB`, `settlements`, `MOA`, `Calypso` (scoring also infers from text) |
| `languages` | Candidate | Spoken languages e.g. `["English","French"]` |
| `yearsExperience` | Candidate | Verified years only — **null if unknown; never invent** |
| `techStack` | Candidate | Skills extracted from OCR (must-haves especially) |
| `industryExperience` | Candidate | When known (e.g. Fintech / Capital Markets) |
| `location` / `timezone` | Candidate | Montreal / remote signals |
| `requiredLanguages` | JobAnalysis | From Language (Must) — e.g. `["English"]` |

Do **not** reimplement scoring or HTTP in SMART — fill fields, then call existing `scoreCandidate` + `selectTopKByMatchScore`.

## Ranking contract

```ts
const scored = bank.map(c => ({ ...c, ...scoreCandidate(c, jd, weights) }));
const batch = selectTopKByMatchScore(scored, count, jd); // NOT bank.slice(0, count)
```

Tie-breakers: matchScore ↓ → must-have hit count ↓ → years present → live>manual>synthetic → id.
