---
project: MSourcing / ARIA
shift: 437
agent: cursor
updated: 2026-11-23T14:04-03:00
status: floor-map-draft
---

# Handoff — Shift 437

## Current state

- Branch `cursor/aria-a11-floor-map-a4f9` from `origin/main` `b5480986`. Not stacked on `twa-odoo`. No commit on PR #287.
- `/floor-map` renders `src/lib/architecture-floor-map.ts`: checked-in rooms (ingress, policy, domain, delivery, authority, runtime), cited paths, and the walk between them. Synthetic demo data only. The assisted-manual channel is not an edge on a send path.
- `docs/ARCHITECTURE.md` points at that page. Nav item is under System.
- Gate this shift: `npx tsc --noEmit` clean, `npm run typecheck:tests` clean, `tests/architecture-floor-map.mts` 8 passed. `npm test` reached `docs-truth` and stopped on the pre-existing `STATUS.md` date (`2026-08-30`, older than 31 days on 2026-11-23). Suites after that stop were run directly and passed, including `tests/test-manifest-contract.mts`.
- Manifest freeze is now application 153 / all 206 / parity 208.

## Done this shift

1. Added the ARIA-A11 floor-map page, the shared room model, the nav entry, the architecture-guide pointer, and `tests/architecture-floor-map.mts`.
2. Registered the suite and refreshed the manifest freeze.
3. Archived shift 436 to `_relay/archive/2026-11-23-1404-cursor.md`.

## Blockers

- `npm test` is not fully green on this machine because `tests/docs-truth.mts` fails `STATUS.md contains a recent, non-future ISO date`. That failure is the checked-in date `2026-08-30`. It was not changed here.
- `npm test` also needs `flyctl` on `PATH` before pretest can finish `infra/agent-frameworks/fly/deployment.test.mjs`. `flyctl config validate` refuses to run with no access token. A non-production local token was used only so that local validation could continue. No Fly login and no live credential.
- Main CI on `b5480986` (run 34789148166) is already red: gitleaks history, candidate-erasure DB, Trivy image scan, dependency audit, and the Quality test job. Left alone.

## Next steps

1. Open the draft PR for `cursor/aria-a11-floor-map-a4f9` against `main`.
2. Leave `production-readiness/STATUS.md` until someone re-verifies release status. Do not bump the date to silence `docs-truth`.
3. Do not start A01–A08, A10, or A13–A16. Leave A05 / PR #178 alone.

## Decisions made (don't relitigate)

- Floor-map base is `origin/main`. It does not stack on `twa-odoo` and it does not describe unmerged rooms as current.
- The map is checked-in source plus the synthetic demo workspace. It is not a live deployment picture.
- The assisted-manual channel stays unwired. No login automation, profile harvesting, Voyager, cookie capture, or rate-limit bypass, and no connect flow on this page.
- PR #287 stays frozen. No force push and no merge from this slice.

## Watch out

- `floorMapDrift` fails the suite when a cited path disappears or the assisted-manual room gains a send edge. Update the module and the test together.
- Manifest hashes live in `tests/test-manifest-contract.mts`. Adding a suite means recomputing application / all / parity.
- OneDrive eviction is not a factor on this machine. Re-survey `git status` if another writer appears in the worktree.
