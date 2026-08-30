---
project: MSourcing / ARIA
shift: 438
agent: cursor-cloud
updated: 2026-08-30T17:30Z
status: branch-pushed-pr-blocked-403
---

# Handoff — Shift 438

## Current state

- **FF tip:** `main` @ `1847c79` (integration ancestor). Fly production still `d9e8cd0`.
- **This shift branch:** `cursor/sourcing-quality-contact-track-b91d` @ tip (push OK).
- **PR create blocked:** `gh pr create` → 403 (`Resource not accessible by integration`). Parent/human must open PR → `main`.
- Gate green locally: `npm run typecheck && npm run typecheck:tests && npm test`.

## Done this shift

1. Horizontal overflow: `overflow-x: clip` on html/body; skip-link no longer `left:-9999px`; app-shell `min-w-0` / `max-w-[100vw]` / `overflow-x-clip`. Unit `tests/layout-overflow.mts`. Fly Settings measured 28px sideways scroll before; CSS inject stopped `scrollX` (proof artifacts under `/opt/cursor/artifacts/`).
2. Calypso BA need fixture `src/lib/fixtures/calypso-ba-need.ts` (AMACAN / BNPP CIB / Montreal / partial remote / 2026-10-05). Intake button “Calypso BA (AMACAN)”. Parser extracts Skill(Must)/Language(Must)/7–10y/boolean.
3. Scoring quality ported onto Europe tip: must-have 92/8, domain signals, language, Montreal, weak/GitHub string dampening, `selectTopKByMatchScore`, floor 80 via `candidate-fit.ts`.
4. Contact tracking: `getContactStatus` + dedupe skips already-contacted / DNC; badges on candidates table + drawer.

## Blockers

- Cannot open PR (403). Parent: `gh pr create --base main --head cursor/sourcing-quality-contact-track-b91d`.
- Fly deploy of this tip still needed for live after-proof (local Turbopack panicked).
- Graph/Microsoft/HeyReach = HOLD.

## Next steps

```bash
gh pr create --base main --head cursor/sourcing-quality-contact-track-b91d \
  --title "fix(sourcing): Calypso BA quality bar, contact tracking, overflow clip"
# After merge → Fly deploy; re-run sourcing E2E with SAMPLE_CALYPSO_BA_NEED
curl -s https://aria-mantu-app.fly.dev/api/ready
```

## Decisions made (don't relitigate)

- main is FF tip over integration for this work.
- Do not restore deleted orchestrator/providers megapr; surgical scoring port only.
- Do not chase Entra/Graph.
- Contacted skip reason preferred over generic Duplicate when identity was already contacted.

## Watch out

- Cherry-picking full `scoring-quality-upgrade-b91d` still conflicts (orchestrator deleted on main).
- `test-manifest-contract` freezes must be refreshed when adding suites.
