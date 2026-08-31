---
project: MSourcing / ARIA
shift: 439
agent: cursor-cloud
updated: 2026-08-31T04:05Z
status: pr-open
---

# Handoff — Shift 439

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54** against `main`
- Contract: `docs/sourcing-engine/DESIGN.md` (AMACAN App Support primary, Senior BA second, floor 60)
- Engine `ScoredRow` now includes `evidence: { skills, cv, linkedin }` citations; `POST /api/source/need` returns them
- Fixture pool is distinct coverage profiles (not 12×80 / 4×63). Recorded shortlist 15, scores 84…60, unique spread ≥8
- Talent Pool / Fly no longer inject `sourceEngineFixtureCandidates` / `@fixture.example`. Mapper stays test-only
- Recorded E2E: `command=tsx tests/sourcing-engine.mts` `exit_code=0` `path=_relay/evidence/trading-need-e2e.json`
  - every shortlist row has `evidence.cv` and `evidence.skills`
  - nameOnlyScore = 0
  - secondNeed = Senior Calypso Business Analyst; combinedNeedCount = 2
- Suites this shift: sourcing-engine 65, source-need-route 10, store-sourcing-actions 43, mantu-intake 35
- `npx tsc --noEmit` and `tsc -p tsconfig.tests.json` clean
- READY TO MERGE stays **no** until Devon Fly-shows

## Done this shift

1. Wired `RowEvidence` through `scoreEvidence` / `ScoredRow` / API JSON
2. Asserted per-row CV + skill citations on the primary `runFixtureSourcing` shortlist in `tests/sourcing-engine.mts`
3. Rewrote App Support fixture people so scores spread from skill/CV/LinkedIn coverage
4. Removed store Talent Pool injection of lab fixtures
5. Re-ran `tsx tests/sourcing-engine.mts` and `scripts/prove-trading-need-e2e.mts`

## Blockers

- Live Fly login proof after land is Devon (`https://aria-mantu-app.fly.dev/`, `twalteur@amaris.com`). Fly still pre this land (v163 when last checked)
- Historic CI (secret scan / dep audit / db-security) matches main — do not chase
- Quality flyctl install already on this branch (`dfc354b`) — leave harness unless Quality fails for a **new** reason
- Live provider search still fail-closes without keys (503 + three paths)
- Image-only PDF / PNG OCR remains fail-closed `OCR_REQUIRED`

## Next steps

```bash
# Devon: deploy this SHA to Fly aria-mantu-app, then login-proof
# Paste tests/fixtures/tony-calypso-amacan-need.txt into Parse JD
# Do not merge until Devon Fly-shows
# Do not open a second PR; do not touch Vercel or Polo or PR #53
```

## Decisions made (don't relitigate)

- Product name is Aria. Calypso is a client **need**, not an app/PR/UI name
- Shortlist floor 60% is not the outreach contact floor (still 70)
- PR #53's undeployed 80 floor is out of scope
- Fixture path proves the matcher in tests + `POST /api/source/need?mode=fixture` only
- Talent Pool / Fly must not present `@fixture.example` lab people
- Clustered synthetic scores are a Fly fail
- One implementer, one PR (#54). Do not start extras
- Fly is the production bar; do not add Vercel-only work

## Watch out

- Manifest freeze is still application **154** / all **207** / parity **209** (no new suite files)
- `npm test` pretest still requires `flyctl` on the runner
- Do not import the historical 723-line `mantu-need-parse.ts` or the tesseract OCR PR
- `engine-candidates.ts` still maps `@fixture.example` for tests; store must not call it
