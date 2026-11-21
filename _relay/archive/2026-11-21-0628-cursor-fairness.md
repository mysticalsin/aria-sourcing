---
project: MSourcing / ARIA
shift: 469
agent: cursor-fairness
updated: 2026-11-21
status: fairness-audit-draft
---

# Handoff - Shift 469

## Current state

- Branch `cursor/aria-fairness-audit` off `twa-odoo` (`e3fa3f59`). Not merged.
- Red-first commit `ea40dadcaf9bf7cf0dc672b0f8bf09b1e8a82773`: tests only, `Audit` and `Generate` returned `fairness: not implemented`. `go test` in `go/fairness` failed 38 tests; `cmd/aria-fairness` failed `TestGenerateThenAudit`. Exit 1. No skips.
- Implementation is the following commit on the same branch. `go test -count=1` and `go test -race -count=1` pass in `go/fairness` and `cmd/aria-fairness`. `go vet` is clean.
- Product code is `go/fairness/**` and `cmd/aria-fairness/**`. CI also touches `docker-compose.yml` (agents healthcheck), `scripts/accept-local-demo.mjs` (visible Manual fields), and `.gitleaksignore` (exact fingerprints from other branches). No edits under `core/`, `services/router`, `services/channels`, the approval ledger, or `odoo_addons/`.
- CLI: `go run ./cmd/aria-fairness generate` and `audit`. `scoreCandidate` in `src/lib/scoring.ts` and `draftLinkedInOutreach` call `src/lib/fairness/live-rank.ts`. Protected attributes and postcode, graduation year, and photo are stripped before the scrubbed score. A flip of those attributes is the counterfactual. Location and years of experience stay as role criteria and are reported when they move the score. No auto-reject.

## Done this shift

- Offline fairness audit for one ranking run: selection-rate parity, integer four-fifths test, rank exposure `1/log2(rank+1)`, name and gender-marker counterfactuals, proxy flags (postcode, graduation year, photo), explanation completeness.
- Verdicts: Insufficient, Pass, Warn, Fail. No auto-reject. Groups under the minimum size (default 30) get no disparity verdict.
- Property tests: bounded ratios, determinism, permutation invariance. Boundary tests at exactly 4/5.
- Red commits for the inspector and the per-attribute strip: `4cea4f1ed818bac461192b3dde32742f62954abd` and `a4e2d9dc074f0a910fb8bd674b29a56239a0372d`. The original red commit remains `ea40dadcaf9bf7cf0dc672b0f8bf09b1e8a82773`.

## Blockers

- None in this package. Local `go test` and `go test -race` were green. The first GitHub head failed Local Docker demo because the agents service disabled its healthcheck, so `compose --wait` aborted. Secret scan with `--all` also matches synthetic fixtures on other branches. The follow-up commit adds the temporary process-alive check, fills the visible Manual name field, and ignores those exact fingerprints.

## Next steps

1. After PR #170 merges, run `go test` for `go/fairness` in CI on each ranking change. Do not add that job on top of the open core, router, ledger, channels, or Odoo diffs.
2. Plug the real scorer in through the `Scorer` interface once the Rust core is the ranking implementation. Keep the protected-group label out of that call.
3. Leave `mbe-*`, `main`, and `vercel-demo` untouched.

## Decisions made (don't relitigate)

- This audit is recruiter prioritisation support. It does not reject a candidate, and it does not certify EU AI Act, GDPR, or anti-discrimination compliance.
- Adverse impact is a selection rate strictly below 4/5 of the reference rate, compared as `selected(g) * n(reference) * 5 < selected(reference) * n(g) * 4`. Exactly 4/5 is not adverse impact. A ratio in [4/5, 9/10) warns.
- A protected-group label counts only when it is self-declared and consented. It is never passed to a Scorer.
- Default minimum group size is 30. That number is operational, not a statutory safe harbour.
- Shift 468 decisions stay in force. Full text: `_relay/archive/2026-11-21-0303-cursor-fairness.md`.

## Watch out

- Do not force-push and do not use `--no-verify`.
- Other open PRs own `core/` (#170), `services/router` (#169), the approval ledger (#167), `services/channels` (#175), and `odoo_addons/aria_recruitment` (#176).
- `go/fairness` has no network imports. Tests fail if a non-test file imports `net` or `net/http`.
- The agents healthcheck is temporary so `compose --wait` can see the runner. PR #168 deletes that service.
- CI and CodeQL use `ubuntu-24.04`. On 2026-11-21 `ubuntu-latest` queued with no runner.
- Gitleaks scans full history. Keep fixture strings obviously synthetic (`SYN-000`, `example` domains, no key-shaped literals).
