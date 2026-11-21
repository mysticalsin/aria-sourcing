---
project: MSourcing / ARIA
shift: 470
agent: cursor-fairness
updated: 2026-11-21
status: fairness-audit-frozen
---

# Handoff - Shift 470

## Current state

- Branch `cursor/aria-fairness-audit` off `twa-odoo` (`e3fa3f59`). Draft PR #180. Not merged.
- Frozen product commits, not pushed until this handoff commit: red `65b366f50591e6ce9f56eaabbe3f906822d0672d`, green `4320e7571067cc0ceb1eb80507c50440b95a245b`.
- `Score` goes through `scoreView`. `SetDenylistForTest` replaces the strip set and restores it. A denylist of `never-matches` leaves protected keys on the view, and `strippingViolation` then fails. The production set strips gender, race, age, ethnicity, religion, disability, postcode, graduation year, photo, and the protected-group label, including aliases and letter case.
- Counterfactual probes are name tokens and gender-marker tokens only. There is no feature-flip `Score` call. A marker swap that moves the score fails the audit. A feature-only candidate produces no `protected-attribute` case.
- `auditLiveScore` scores the scrubbed map, plus location and years-of-experience alternates. It does not reattach a stripped key. `scoreCandidate` clears `avatarUrl` before `scoreCandidateCore`. Location and years stay as role criteria and warn. `autoReject` stays false.
- No edits under `core/`, `services/router`, `services/channels`, the approval ledger, or `odoo_addons/`.

## Done this shift

- Closed the two admitted gaps, red then green. The red commit is the mutant denylist plus an every-call recording scorer and a marker-token gender spy. The green commit makes the seam real and deletes the raw-field probes.
- Earlier red commits stay: `ea40dadcaf9bf7cf0dc672b0f8bf09b1e8a82773` (unimplemented), `4cea4f1ed818bac461192b3dde32742f62954abd` (inspector spy on the old feature path), `a4e2d9dc074f0a910fb8bd674b29a56239a0372d` (per-key check on text-swap views only).

## Blockers

- None in this package. GitHub Actions was not waited on. The exact-head suite is the block in PR #180 for the commit that contains this handoff.
- `npm run build` stops once on the Next.js security advisory and succeeds on the retry. Do not run `next upgrade`. PR #179 owns that upgrade.

## Next steps

1. Leave this branch frozen. Do not push again to retrigger Actions.
2. After PR #170 merges, run `go test` for `go/fairness` in CI on each ranking change. Do not add that job on top of the open core, router, ledger, channels, or Odoo diffs.
3. Plug the real scorer in through the `Scorer` interface once the Rust core is the ranking implementation. Keep protected attributes, proxies, and the protected-group label out of that call.

## Decisions made (don't relitigate)

- This audit is recruiter prioritisation support. It does not reject a candidate, and it does not certify EU AI Act, GDPR, or anti-discrimination compliance.
- Adverse impact is a selection rate strictly below 4/5 of the reference rate, compared as `selected(g) * n(reference) * 5 < selected(reference) * n(g) * 4`. Exactly 4/5 is not adverse impact. A ratio in [4/5, 9/10) warns.
- A protected-group label counts only when it is self-declared and consented. It is never passed to a Scorer.
- Production scoring never passes a protected attribute or a proxy (postcode, graduation year, photo) to the scorer. The counterfactual may vary name and marker tokens only, and it reports the score delta from that swap.
- Default minimum group size is 30. That number is operational, not a statutory safe harbour.
- Shift 469 decisions stay in force. Full text: `_relay/archive/2026-11-21-0628-cursor-fairness.md`.

## Watch out

- Do not force-push and do not use `--no-verify`. Do not touch `mbe-*`, `main`, or `vercel-demo`.
- Other open PRs own `core/` (#170), `services/router` (#169), the approval ledger (#167), `services/channels` (#175), and `odoo_addons/aria_recruitment` (#176).
- `go/fairness` has no network imports. Tests fail if a non-test file imports `net` or `net/http`. Tests must not call `t.Skip`.
- The agents healthcheck is temporary so `compose --wait` can see the runner. PR #168 deletes that service.
- CI and CodeQL use `ubuntu-24.04`. On 2026-11-21 `ubuntu-latest` queued with no runner.
- Gitleaks scans full history. Keep fixture strings obviously synthetic (`SYN-000`, `example` domains, no key-shaped literals).
