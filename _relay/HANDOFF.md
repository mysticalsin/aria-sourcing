---
project: MSourcing / ARIA
shift: 438
agent: cursor-cloud
updated: 2026-08-31T03:28Z
status: pr-open
---

# Handoff — Shift 438

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54** against `main`
- Contract: `docs/sourcing-engine/DESIGN.md` (AMACAN App Support primary, Senior BA second, floor 60)
- Engine: `src/lib/sourcing/engine.ts` + compact VSS `src/lib/sourcing/vss-need.ts`
- Fixtures restored: `tests/fixtures/tony-calypso-amacan-need.txt`, `tests/fixtures/ocr/calypso-ba-montreal-need.{pdf,png}`, `tests/fixtures/sample-vss-calypso-ba-montreal.txt`, `SAMPLE_VSS_CALYPSO_BA_MONTREAL`
- Polo and PR #53 left untouched
- Recorded E2E: `command=tsx tests/sourcing-engine.mts` `exit_code=0` `path=_relay/evidence/trading-need-e2e.json`
  - need = Calypso Application Support
  - shortlist 16, scores 80 then 63, cap 20, floor 60
  - nameOnlyScore = 0 (FAIL under 60)
  - secondNeed = Senior Calypso Business Analyst; combinedNeedCount = 2
- `npx tsc --noEmit` and `tsc -p tsconfig.tests.json` clean
- Suites: sourcing-engine 51, mantu-intake 34, source-need-route 8, plus scoring-quality/metrics/intake/mock-ai green
- Full `npm test` pretest still fails here on `flyctl ENOENT` — environment, not this diff

## Done this shift

1. Locked DESIGN.md acceptance on the two AMACAN/BNPP needs before more engine code
2. Restored in-repo VSS/OCR fixtures from history (did not invent new JD copies)
3. Compact VSS parser (line-oriented + colon). Wired into engine + `parseEmailAndJD` so intake is not empty
4. Retargeted fixture pool to App Support (Linux/Python/Oracle/Grafana/Dynatrace + Calypso settlement) and BA (Calypso/BA/MySQL)
5. Negative: Calypso Martinez name-only scores 0
6. Combined VSS paste recovers both titles
7. GitHub `language:` only for real languages; LinkedIn boolean no longer emits empty `AND ()`
8. Complete VSS skips the cloud parser (no empty brief / “cloud did not complete” wipe)
9. Demo Talent Pool for these needs uses the engine fixture shortlist (≤20, floor 60, CV/LinkedIn evidence, name-only skipped). Not dressed as live.

## Blockers

- Live Fly login proof after land is Devon (`https://aria-mantu-app.fly.dev/`, `twalteur@amaris.com`)
- Live provider search still fail-closes without keys (503 + three paths)
- Image-only PDF / PNG OCR remains fail-closed `OCR_REQUIRED` (no tesseract pulled)

## Next steps

```bash
npx tsx scripts/prove-trading-need-e2e.mts
# Review/merge PR #54: https://github.com/mysticalsin/aria-sourcing/pull/54
# Do not merge PR #53 from this branch; do not touch Polo
# Devon: Fly login proof after land — paste tony-calypso-amacan-need.txt into Parse JD
```

## Decisions made (don't relitigate)

- Product name is Aria. Calypso is a client **need**, not an app/PR/UI name
- Shortlist floor 60% is not the outreach contact floor (still 70)
- PR #53's undeployed 80 floor is out of scope
- Fixture path proves the matcher; live path fail-closes without keys
- One implementer, one PR (#54). Do not start extras
- Fly is the production bar; do not add Vercel-only work

## Watch out

- Manifest freeze is still application **154** / all **207** / parity **209** (no new suite files)
- `npm test` pretest still requires `flyctl` on the runner
- Do not import the historical 723-line `mantu-need-parse.ts` or the tesseract OCR PR
