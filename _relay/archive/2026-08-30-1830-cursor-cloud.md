---
project: MSourcing / ARIA
shift: 439
agent: cursor-cloud
updated: 2026-08-30T17:55Z
status: branch-pushed-pr53-closed-needs-reopen
---

# Handoff — Shift 439

## Current state

- **FF tip:** `main` @ `1847c79` (integration ancestor).
- **This shift branch:** `cursor/sourcing-quality-contact-track-b91d` @ `3bfb6f7`.
- **PR #53:** CLOSED (not merged) at 2026-08-30T17:46Z. Agent cannot reopen/edit (403). Parent must `gh pr reopen 53` and refresh body, or reopen from GitHub UI — **do not open a second PR**.
- Gate green locally: `npm run typecheck && npm run typecheck:tests && npm test`.

## Done this shift

1. Need-agnostic elevation on same branch (no second PR):
   - Fixture `src/lib/fixtures/senior-ts-europe-need.ts` (Senior TypeScript Engineer / Berlin / Europe) + Intake button.
   - `buildSourcingStrategy`: GitHub/LinkedIn queries from **that** need’s skills/boolean — removed hardcoded `Calypso` query path; Calypso still golden via its must-haves.
   - Geo: city matching from JD location/regions (Montreal **and** Berlin/Europe/CET), not Montreal-only.
   - `selectTopKByMatchScore` / `clampShortlistTopK`: **5–20** shortlist band; live mappers use max 20.
   - Parse: IS&D title strip for any need; EU city → CET/EU regions; tech industry tagging.
   - Finance role family includes Calypso/BA signals.
2. Tests in `tests/scoring-quality.mts`: Calypso golden + TS Europe pipeline, must-have rejection, top-K clamp, contact/DNC dedupe for both needs (65 pass).

## Blockers

- PR #53 closed + body/edit/reopen 403. Parent:
  ```bash
  gh pr reopen 53
  # then update title/body to need-agnostic summary (see Done), base main, head cursor/sourcing-quality-contact-track-b91d
  ```
- Fly deploy of tip still needed for live after-proof.
- Graph/Microsoft/HeyReach = HOLD.

## Next steps

```bash
gh pr reopen 53
gh pr edit 53 --title "Sourcing: need-agnostic quality bar, contact tracking, overflow clip"
# After merge → Fly deploy; E2E with SAMPLE_CALYPSO_BA_NEED and SAMPLE_TS_EUROPE_NEED
curl -s https://aria-mantu-app.fly.dev/api/ready
```

## Decisions made (don't relitigate)

- main is FF tip over integration for this work.
- Do not restore deleted orchestrator/providers megapr; surgical scoring port only.
- Do not chase Entra/Graph.
- Contacted skip reason preferred over generic Duplicate when identity was already contacted.
- Calypso remains one golden fixture; quality bar must be need-agnostic (second golden = TS Europe).
- Shortlist top-K clamped 5–20 (not unbounded first-N from API order).

## Watch out

- Cherry-picking full `scoring-quality-upgrade-b91d` still conflicts (orchestrator deleted on main).
- `test-manifest-contract` freezes must be refreshed when adding suites.
- Do **not** open a second PR for this work — reopen #53.
