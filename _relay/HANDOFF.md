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
- New paths only: `go/fairness/**`, `cmd/aria-fairness/**`, and this relay note. No edits under `core/`, `services/router`, `services/channels`, the approval ledger, or `odoo_addons/`.
- CLI: `go run ./cmd/aria-fairness generate` and `audit`, from the module directories. Synthetic fixtures only. No scorer is wired in the CLI, so counterfactual stays Insufficient until a caller passes a `fairness.Scorer`.

## Done this shift

- Offline fairness audit for one ranking run: selection-rate parity, integer four-fifths test, rank exposure `1/log2(rank+1)`, name and gender-marker counterfactuals, proxy flags (postcode, graduation year, photo), explanation completeness.
- Verdicts: Insufficient, Pass, Warn, Fail. No auto-reject. Groups under the minimum size (default 30) get no disparity verdict.
- Property tests: bounded ratios, determinism, permutation invariance. Boundary tests at exactly 4/5.

## Blockers

- None in this package. Local `go test` and `go test -race` were green. GitHub CI on the draft PR had not been observed yet at this commit.

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
- Gitleaks scans full history. Keep fixture strings obviously synthetic (`SYN-000`, `example` domains, no key-shaped literals).
