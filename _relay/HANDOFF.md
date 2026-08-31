---
project: MSourcing / ARIA
shift: 437
agent: cursor-cloud
updated: 2026-08-31T03:04Z
status: pr-open
---

# Handoff — Shift 437

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54** against `main` (`1847c79`)
- Contract: `docs/sourcing-engine/DESIGN.md` (committed first)
- Engine: `src/lib/sourcing/engine.ts` + OCR `src/lib/sourcing/ocr.ts` + `POST /api/source/need`
- Polo and PR #53 left untouched
- Live probe (this shift): Vercel demo `/api/source` unauth **401**; Fly `/api/source` unauth **403 CROSS_ORIGIN_REQUEST** (not the Aug 25 unauth-500 hunch)
- `npx tsc --noEmit` clean; `tsc -p tsconfig.tests.json` clean
- Application group green (`node scripts/run-test-manifest.mjs --group application`); new suites 34 + 8 pass
- Full `npm test` pretest fails here on `flyctl ENOENT` in `infra/agent-frameworks/fly/deployment.test.mjs` — environment, not this diff

## Done this shift

1. Framed sourcing-engine contract before code
2. Implemented need parse (paste / email / text-layer PDF), score (skills 50 / CV 30 / LinkedIn 20), floor 60, cap 20, name-only + empty FAIL
3. Auth + Walteur fail-closed on `/api/source/need`; live mode does not invent people
4. Recorded E2E: `command=tsx tests/sourcing-engine.mts` `exit_code=0` `path=_relay/evidence/trading-need-e2e.json`

## Blockers

- None for the engine PR
- Live provider search still goes through existing `/api/source/*` + `liveEvidence` (no invented rows). Missing keys → 503 + three paths

## Next steps

```bash
npx tsx scripts/prove-trading-need-e2e.mts
# Review/merge PR #54: https://github.com/mysticalsin/aria-sourcing/pull/54
# Do not merge PR #53 from this branch; do not touch Polo
```

## Decisions made (don't relitigate)

- Product name is Aria. Calypso is a trading-platform **need**, not an app/PR/UI name
- Shortlist floor 60% is not the outreach contact floor (still 70)
- Fixture path proves the matcher; live path fail-closes without keys
- One implementer, one PR (#54). Do not start extras

## Watch out

- Manifest freeze is now application **154** / all **207** / parity **209**
- `npm test` pretest still requires `flyctl` on the runner
- PR #53 (need-agnostic quality, 80 floor, soft-empty) is a different branch — do not mix
