---
project: MSourcing / ARIA
shift: 437
agent: cursor-qa
updated: 2026-11-25T15:55:00-03:00
status: pr-303-qa-fixed-draft
---

# Handoff — PR 303 interviewer QA

## Current state

- Draft PR https://github.com/mysticalsin/aria-sourcing/pull/303 stays a draft. Not merged. MERGE HOLD.
- Branch `cursor/a16-interviewer-handoff-1aac`. Base is `main` at `b5480986fe6a749f24d106dbd519bb5e0b2be2ef`.
- Previous tip `6fd93f414c5a306ec04f2d972f048e43096df870` (tree `687a10cb9c340d872f5440115f7cf8039e89d3f1`).
- QA fix commit is the tip of `cursor/a16-interviewer-handoff-1aac` after this shift's push. Go package `go/interviewer` only, plus this baton.
- No live interviewer host was contacted. Tests use the in-process fake.

## Done this shift

- Red-first QA on the flag-off hand-off adapter. Failing tests in `go/interviewer/gap_test.go`, then fixes in redact, report, validate, and service.
- `go test -count=1 ./...` and `go test -count=1 -race ./...` in `go/interviewer` passed.
- `npx tsc --noEmit` passed. `npm test` still stops at `infra/agent-frameworks/fly/deployment.test.mjs` with `spawnSync flyctl ENOENT`. That check was not changed.

## Blockers

- Draft stays draft. Do not merge. Do not retarget main.
- Inherited CI on the previous tip was already red: npm audit, image scan, release gate, flyctl in Quality, gitleaks, database security. Those checks were not edited.

## Next steps

1. Confirm the push of this QA commit landed on `cursor/a16-interviewer-handoff-1aac` and the PR head moved. Leave the draft flag set.
2. Do not merge #303 until the hold is lifted.
3. Interviewer wiring to Odoo stays out of this PR.

## Decisions made (don't relitigate)

- #49 closed permanently; #51 was the Europe successor — now merged
- Keep focused Europe/EMEA geo+scoring slice — no megapr #36 reopen
- Slim Fly deploy preserves live 0079 migration identity (tip tree ledger ends 0054)
- Ignore Vercel/GHA budget noise
- PR 303 stays flag-off. `ARIA_INTERVIEWER_ENABLED` is only `true`, `TRUE`, `True`, or `1`.
- The hand-off recommendation stays advisory. It does not change an Odoo stage.
- Scores are integers 0–5. Overall, when present, is on that same scale. A missing score is not zero.
- A known verdict must name the same recommendation. `strong_no_hire` may use the human label `Not Qualified`, which has no stronger verdict.
- Contact scrubbing covers compact and international phones, `//` URLs, `mailto:`, and `tel:`.
- Redirects are not followed and are `ErrRemote`, not infrastructure.

## Watch out

- `npm test` on this tree fails at flyctl before the application group finishes. That failure is inherited.
- Manifest on this branch is the PR 303 freeze (application 153 / all 206 / parity 208), not the shift 436 numbers.
- The caller must keep the `Handoff` value. This package does not persist it.
