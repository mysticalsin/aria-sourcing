# CI/CD Review — MSourcing (hermes-sourcing)

**Area:** Phase 8 — CI/CD pipeline, branch protection, pipeline gates, deploy approval
**Reviewer role:** DevSecOps / Pipeline Engineer
**Date:** 2026-06-27
**Repo:** `/Users/tony/.../TEST/MSourcing` — git branch `main`, **working tree DIRTY** (audited as-is)
**Gate mapped:** Gate 8 — CI/CD / supply chain
**Companion files:** `SUPPLY_CHAIN_SECURITY_REPORT.md`, `RELEASE_AND_ROLLBACK_REPORT.md`

> Supersedes the Gate 8 row in `RELEASE_GATE_MATRIX.md` (which read "no CI config in
> repo; no remote"). CI **config now exists** (`ci.yml`, `codeql.yml`) — but the
> pipeline is **non-functional** because there is still **no git remote**, so it has
> never executed and branch protection cannot be applied. Net Gate 8 verdict unchanged: **FAIL**.

---

## Executive summary

The repo now ships a reasonable-looking CI workflow (typecheck → lint → test → build →
`npm audit` → gitleaks) plus a CodeQL SAST workflow. On paper this is a credible
baseline. In reality the pipeline is **decorative**:

1. **No git remote is configured** (`git remote -v` returns empty; no upstream for
   `main`). GitHub Actions only run on GitHub. With no remote, **neither `ci.yml` nor
   `codeql.yml` has ever executed**, and there is **zero CI run history** to cite as
   evidence. Every "gate" below is unproven in practice.
2. **The one hard supply-chain gate is disabled** — `npm audit` runs with `|| true`
   (non-blocking), so the **4 high-severity `next` advisories currently present pass CI**.
3. **No branch protection, no required reviews, no CODEOWNERS** — impossible to enforce
   without a remote, and no `CODEOWNERS` file exists in the tree to drive code-owner review.
4. **No prod-deploy approval gate** — deploy is implicitly Vercel's git integration; there
   is no GitHub Environment, no required reviewer, no four-eyes control on production.
5. **Build reproducibility drift** — CI pins Node 20, local toolchain is Node 22, and there
   is no `engines`/`.nvmrc`/`packageManager` pin. Vercel's runtime Node version is not
   pinned in-repo.

What is genuinely good: `npm ci` (lockfile-respecting install), `package-lock.json`
present and tracked (`lockfileVersion: 3`), real tests wired into CI that pass locally
(`test:security` → 87 assertions, 0 failed), CodeQL configured weekly + on push/PR, and
no secrets are injected into CI build steps (only `GITHUB_TOKEN` for gitleaks).

**Gate 8 (CI/CD half): FAIL** — open HIGH findings (non-functional pipeline / no remote,
exploitable deps not blocked by CI, no prod-deploy approval gate). Several policy controls
(branch protection, required reviews, Vercel env-secret scoping) are **UNKNOWN — blocked
on access** to the (not-yet-existing) GitHub org and Vercel project.

---

## What was reviewed (evidence map)

| Item | Source | Result |
|---|---|---|
| CI workflow | `.github/workflows/ci.yml` (working tree, MODIFIED) | typecheck/lint/test/build/audit/gitleaks present |
| SAST | `.github/workflows/codeql.yml` | CodeQL js-ts, push/PR + weekly cron |
| Remote / CI execution | `git remote -v` → empty; `git rev-parse @{u}` → "no upstream" | **No remote — workflows never ran** |
| Install determinism | `ci.yml:25` `npm ci`; `vercel.json:37` `npm ci`; `package-lock.json` tracked, `lockfileVersion: 3` | PASS |
| Node pinning | `ci.yml:21` node 20; local `node --version` → v22.22.3; no `engines`, no `.nvmrc`, no `packageManager` | Drift — MEDIUM |
| Branch protection / required reviews | n/a — no remote; no `CODEOWNERS` (`find . -name CODEOWNERS` → none) | UNKNOWN / missing |
| Secret scan | `ci.yml:42` `gitleaks/gitleaks-action@v2` (only `GITHUB_TOKEN` set) | Present, license caveat |
| Dep audit gate | `ci.yml:40` `npm audit --audit-level=high || true` | **Non-blocking** — HIGH |
| Container/IaC scan | no Dockerfile / tf / compose / k8s in tree | N/A (nothing to scan) |
| Secrets in PR builds/logs | `ci.yml` injects no app secrets into build/test steps | PASS |
| Deploy approval | no deploy/release workflow; no GitHub Environment in repo | Missing — HIGH |
| Tests run in CI | `npm run test:security` → 15+9+23+17+11+12 = 87 passed, 0 failed (run 2026-06-27) | Tests real & green |

Reproduction commands used:
```bash
git remote -v                      # (empty output, exit 0)
git rev-parse --abbrev-ref --symbolic-full-name @{u}   # fatal: no upstream configured for branch 'main'
node --version                     # v22.22.3   (CI uses node 20)
node -e "require('./node_modules/next/package.json').version"   # 14.2.35
npm run test:security              # 87 passed, 0 failed
find . -name CODEOWNERS -not -path '*/node_modules/*'  # (none)
grep -riE 'provenance|slsa|cosign|attestation' .github/  # (none)
```

---

## Findings

## [HIGH] CI/CodeQL/secret-scan pipeline is non-functional — no git remote, zero run history
- **Area / Affected:** `.github/workflows/ci.yml`, `.github/workflows/codeql.yml`; git config (`git remote -v` empty, `main` has no upstream)
- **Description:** GitHub Actions only execute on a GitHub-hosted repository. The repo has **no remote configured** and `main` has no upstream branch. The two workflows are committed but have **never run** — there is no Actions history, no SARIF uploaded to code-scanning, no gitleaks result, no green/red status to gate merges on.
- **Impact:** Every claimed CI gate (typecheck, lint, test, build, SAST, secret scan, audit) is **unverified in practice**. Defects, leaked secrets, and vulnerable deps can land on `main` with no automated catch. Branch protection / required status checks are impossible to enforce. The Vercel git-integration deploy path also depends on a remote, so the documented `git push origin main` deploy flow does not work today either.
- **Likelihood:** Certain (the pipeline cannot run as configured).
- **Reproduction:** `git remote -v` → empty; `git rev-parse --abbrev-ref --symbolic-full-name @{u}` → `fatal: no upstream configured for branch 'main'`.
- **Evidence:** Command output above; `ci.yml:1-46`; `INVENTORY.md` already notes "CI cannot run without a remote".
- **Recommended fix:** Create the GitHub repo, push `main`, confirm both workflows execute green, then capture a run URL as evidence. Until a real run exists, treat all CI gates as UNKNOWN.
- **Tests to add:** A "CI must be green on the source commit" pre-deploy check; a status-badge / `gh run list` assertion in the release checklist.
- **Status:** OPEN
- **Owner:** Tony
- **Residual risk:** High until a remote exists and a run is captured.

## [HIGH] Dependency audit gate is non-blocking — 4 high-severity `next` advisories pass CI
- **Area / Affected:** `.github/workflows/ci.yml:40` (`npm audit --audit-level=high || true`); `next@14.2.35` (installed, confirmed)
- **Description:** `npm audit` reports **5 vulnerabilities (4 high, 1 moderate)**, all rooted in `next@14.2.35` and its transitive `postcss`/`glob`. The CI audit step swallows the exit code with `|| true`, so the build is green regardless. Several advisories are directly relevant to this app's security model — notably *Next.js Middleware/Proxy bypass* and *Middleware/Proxy redirects can be cache-poisoned* (the app's auth gate is `middleware.ts`), plus *SSRF via WebSocket upgrades* (the app proxies to Hermes and uses Supabase WSS) and *XSS in App Router with CSP nonces*.
- **Impact:** Known-exploitable framework vulnerabilities ship to production with no pipeline stop. Full detail and remediation in `SUPPLY_CHAIN_SECURITY_REPORT.md`.
- **Likelihood:** High (advisories are public; some map to the app's actual attack surface).
- **Reproduction:** `npm audit --audit-level=high` → "5 vulnerabilities (1 moderate, 4 high)".
- **Evidence:** npm audit output (2026-06-27); `ci.yml:40`; `next` version `14.2.35`.
- **Recommended fix:** Remove `|| true` so high+ findings fail CI; bump `next` to a patched release (see supply-chain report); add an allowlist file for accepted advisories rather than a blanket bypass.
- **Tests to add:** CI job that fails on `audit-level=high`; scheduled SCA (Dependabot/Renovate) — see supply-chain report.
- **Status:** OPEN
- **Owner:** Tony
- **Residual risk:** High while non-blocking.

## [HIGH] No prod-deploy approval gate / environment protection
- **Area / Affected:** No deploy/release workflow (`grep -ril deploy .github/workflows` → none); no GitHub Environment; `DEPLOYMENT_RUNBOOK.md:117` "git push origin main → Vercel auto-builds"
- **Description:** Production deploy is implicit via Vercel's git integration (or `vercel --prod`). There is **no required-reviewer approval, no GitHub Environment with protection rules, no manual gate** between a merge and production. Anyone with push/Vercel access ships to prod handling candidate PII and OAuth mailbox tokens.
- **Impact:** No four-eyes control on production releases; a single actor (or a compromised token) can push to prod. No audit trail of "who approved this deploy".
- **Likelihood:** Medium-High.
- **Reproduction:** No deploy workflow exists; no environment config in repo.
- **Evidence:** `find/grep` over `.github/`; `DEPLOYMENT_RUNBOOK.md` §4.
- **Recommended fix:** Add a GitHub Environment `production` with required reviewers + branch restriction; gate the Vercel production promote behind it (or use Vercel's deployment protection / required GitHub checks). Document the approver in the release checklist.
- **Tests to add:** Release-gate check that a production deploy carries an approval record.
- **Status:** OPEN
- **Owner:** Tony
- **Residual risk:** High until an approval gate exists.

## [MEDIUM] No branch protection, required reviews, or CODEOWNERS
- **Area / Affected:** git config (no remote → no branch protection); no `CODEOWNERS` file in tree
- **Description:** There is no `CODEOWNERS` file, and (consequent to the no-remote finding) no branch-protection rules, no required PR reviews, no required status checks, no linear-history/signed-commit enforcement. `ci.yml` triggers on `branches: ["**"]` which is fine, but nothing *requires* it to pass before merge.
- **Impact:** Direct pushes to `main` are possible; code can merge without review or green CI; security-sensitive paths (`api/keys`, `api/hermes/*`, `middleware.ts`, `lib/rbac.ts`) have no mandatory code-owner sign-off.
- **Likelihood:** Medium.
- **Reproduction:** `find . -name CODEOWNERS` → none; no remote to hold protection rules.
- **Evidence:** filesystem; git config.
- **Recommended fix:** Add `.github/CODEOWNERS` (require review on `api/`, `lib/`, `middleware.ts`, `.github/`, `supabase/migrations/`). After the remote exists, enable branch protection on `main`: require PR + 1 review + green `CI` + green CodeQL, dismiss stale approvals, restrict direct push, require signed commits.
- **Tests to add:** A periodic check that branch-protection settings match policy (e.g. `gh api repos/:owner/:repo/branches/main/protection`).
- **Status:** OPEN (CODEOWNERS absence) / UNKNOWN — blocked on remote (protection rules)
- **Owner:** Tony
- **Residual risk:** Medium.

## [MEDIUM] Build reproducibility drift — unpinned Node, CI vs local mismatch
- **Area / Affected:** `ci.yml:21` (node 20); local `node --version` v22.22.3; no `engines`/`.nvmrc`/`packageManager`; `vercel.json` does not pin Node
- **Description:** CI builds on Node 20, the local toolchain is Node 22 (the `ci.yml` diff actually *changed* CI from 22→20, widening the gap), and there is no `engines` field, `.nvmrc`, `.node-version`, or `packageManager` to pin the runtime. Vercel's Node version is configured in the Vercel dashboard, not in-repo (UNKNOWN).
- **Impact:** "Works in CI / breaks on Vercel" (or vice-versa) class of failures; non-reproducible builds; a dependency that behaves differently across Node majors can pass CI and fail in prod.
- **Likelihood:** Medium.
- **Reproduction:** compare `ci.yml:21` vs `node --version`; `grep engines package.json` → none.
- **Evidence:** `ci.yml:18-22`; `package.json` (no `engines`); ci.yml diff (node 22→20).
- **Recommended fix:** Add `"engines": { "node": ">=20 <21" }` (or the chosen LTS), add `.nvmrc`, and pin Vercel's Node version to match CI. Align CI, local, and Vercel on one LTS.
- **Tests to add:** CI step asserting `node --version` matches `.nvmrc`.
- **Status:** OPEN
- **Owner:** Tony
- **Residual risk:** Medium.

## [MEDIUM] GitHub Actions pinned to mutable tags, not commit SHAs
- **Area / Affected:** `ci.yml` (`actions/checkout@v4`, `actions/setup-node@v4`, `gitleaks/gitleaks-action@v2`); `codeql.yml` (`github/codeql-action/*@v3`)
- **Description:** All third-party actions are referenced by mutable major-version tags. A compromised or retagged action could inject malicious steps into the build (which has access to `GITHUB_TOKEN` and, in any future deploy job, deploy credentials).
- **Impact:** Supply-chain risk on the CI runner; tag mutation = silent code change. CIS/SLSA guidance is to pin actions to full commit SHAs.
- **Likelihood:** Low-Medium.
- **Reproduction:** read both workflow files.
- **Evidence:** `ci.yml:16,19,43`; `codeql.yml:23,26,31,33`.
- **Recommended fix:** Pin each action to a full 40-char commit SHA (with a version comment), and enable Dependabot for `github-actions` to bump them safely.
- **Tests to add:** A lint that rejects non-SHA action refs (e.g. `actionlint` / a grep gate).
- **Status:** OPEN
- **Owner:** Tony
- **Residual risk:** Medium. (Also tracked in `SUPPLY_CHAIN_SECURITY_REPORT.md`.)

## [MEDIUM] gitleaks-action license + scope caveats — secret scan may no-op
- **Area / Affected:** `ci.yml:42-45` `gitleaks/gitleaks-action@v2`
- **Description:** `gitleaks-action@v2` requires a `GITLEAKS_LICENSE` env for **organization** accounts; only `GITHUB_TOKEN` is provided. On an org repo the action can fail or refuse to scan. There is also no `.gitleaks.toml` config, so detection uses defaults, and on PRs the action scans the PR diff (not necessarily full history). With no remote, it has never run at all.
- **Impact:** Secret scanning may silently no-op on an org-owned repo; committed secrets could go undetected.
- **Likelihood:** Medium (depends on whether the future repo is personal or org-owned — UNKNOWN).
- **Reproduction:** `ci.yml:42-45` shows no `GITLEAKS_LICENSE`; no `.gitleaks.toml` in tree.
- **Evidence:** workflow file; absence of config (`find . -name '*.gitleaks*'` → none).
- **Recommended fix:** Decide repo ownership; if org-owned, add `GITLEAKS_LICENSE` secret. Add a `.gitleaks.toml` with redaction + allowlist for the `.env*.example` placeholders. Add a `--no-git`/full-history scan job for the initial onboarding scan. Verify a real run produces a report.
- **Tests to add:** Seed a fake secret in a throwaway branch and confirm gitleaks flags it.
- **Status:** UNKNOWN — blocked on repo-ownership decision
- **Owner:** Tony
- **Residual risk:** Medium.

## [LOW] No coverage threshold / E2E / contract tests in CI; bespoke tsx runner
- **Area / Affected:** `package.json:12` (`test` = 22 chained `tsx tests/*.mts`); `ci.yml:33-34`
- **Description:** CI runs a custom chain of 22 `tsx` suites (good signal — they pass: `test:security` = 87 assertions green), but there is no coverage gate, no E2E (Playwright is present as MCP only), and the suites stop at the first failing file (`&&` chain) so later suites are skipped on an early failure. (Deeper QA assessment is the QA reviewer's gate; noted here only for the CI-config angle.)
- **Impact:** Partial test signal; no coverage floor to prevent regression of untested paths; a single early failure hides downstream results.
- **Likelihood:** Low.
- **Reproduction:** `package.json:12`.
- **Evidence:** `package.json` test script; `test:security` run output.
- **Recommended fix:** Run suites independently (matrix or a runner that doesn't short-circuit), add a coverage threshold, add at least a smoke E2E in CI.
- **Status:** OPEN
- **Owner:** Tony
- **Residual risk:** Low (defer to QA gate).

---

## Sub-gate scorecard (CI/CD)

| Sub-check | Status | Evidence |
|---|---|---|
| Pipeline exists & runs | **FAIL** | config present but no remote → never executed |
| Lint gate | UNKNOWN | `ci.yml:30-31` present, never run on remote |
| Typecheck gate | UNKNOWN | `ci.yml:27-28` present; locally clean per prior evidence |
| Test gate | PARTIAL | wired in CI; `test:security` 87 pass locally; never run in CI |
| SAST (CodeQL) | UNKNOWN | `codeql.yml` present, never executed (no remote) |
| SCA / dep audit | **FAIL** | `npm audit` present but `|| true` (non-blocking); 4 high open |
| Secret scan | UNKNOWN / caveat | gitleaks present; license+scope caveats; never run |
| IaC scan | N/A | no IaC in repo |
| Container scan | N/A | no Dockerfile/registry |
| Branch protection / required reviews | UNKNOWN/FAIL | no remote; no CODEOWNERS |
| Prod-deploy approval | **FAIL** | no environment/approval gate |
| Secrets absent from PR builds/logs | **PASS** | CI injects no app secrets |
| Deps pinned (lockfile) | **PASS** | `npm ci` + tracked `package-lock.json` v3 |
| Build reproducibility | FAIL/MEDIUM | Node drift; no `engines`/`.nvmrc` |

**CI/CD verdict: FAIL** (open HIGH: non-functional pipeline, non-blocking audit with high
vulns, no prod-deploy approval). Supply-chain and release/rollback halves in the companion files.
