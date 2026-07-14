# Supply-Chain Security Report — MSourcing (hermes-sourcing)

> SUPERSEDED by `STATUS.md` 2026-07-10 for current release posture. Historical 2026-06-27 evidence may contain stale stack versions, suite counts, migration ranges, and verdicts.


**Area:** Phase 8 — Software supply chain (deps, SCA, SBOM, provenance, action integrity, secret scanning)
**Reviewer role:** DevSecOps / Pipeline Engineer
**Date:** 2026-06-27
**Repo:** `/Users/tony/.../TEST/MSourcing` — branch `main`, working tree DIRTY (audited as-is)
**Gate mapped:** Gate 8 — CI/CD / supply chain
**Baselines:** OWASP Top 10 (A06 Vulnerable Components), NIST SSDF (PW.4, PS.2, PS.3), SLSA, CIS Controls 7/16
**Companion files:** `CICD_REVIEW.md`, `RELEASE_AND_ROLLBACK_REPORT.md`

---

## Executive summary

Dependency **determinism** is good: installs use `npm ci` against a tracked
`package-lock.json` (`lockfileVersion: 3`), so transitive versions are pinned and
reproducible. That is the strongest positive in Gate 8.

Dependency **hygiene** is not. `npm audit` reports **5 vulnerabilities — 4 high, 1
moderate — all rooted in `next@14.2.35`** (and its transitive `postcss`, `glob`,
`@next/eslint-plugin-next`). The installed Next.js (14.2.35) carries **14 published
advisories**, several of which map directly onto this app's actual attack surface
(middleware-based auth gate, the Hermes proxy / SSRF, App-Router CSP, image optimizer).
The CI audit step that should catch this is **non-blocking** (`npm audit ... || true`),
so these high findings ship green.

There is **no continuous SCA** (no Dependabot/Renovate/Snyk), **no SBOM**, **no build
provenance/attestation/signing**, and **GitHub Actions are pinned to mutable tags** rather
than commit SHAs. Secret scanning (gitleaks) is configured but has license/scope caveats
and — like all CI here — has never executed because there is no git remote (see
`CICD_REVIEW.md`).

**Supply-chain verdict: FAIL** — open HIGH (exploitable framework deps not blocked by CI).
SBOM/provenance/SCA-tooling gaps are MEDIUM and additionally fail NIST SSDF expectations.

---

## 1. Dependency inventory & determinism

| Aspect | Finding | Evidence |
|---|---|---|
| Lockfile present & tracked | Yes | `package-lock.json` (280 KB), `git ls-files` includes it |
| Lockfile version | 3 (npm 7+) | `require('./package-lock.json').lockfileVersion` → 3 |
| Deterministic install | Yes — `npm ci` in CI and Vercel | `ci.yml:25`, `vercel.json:37` |
| Direct dep specifiers | Caret ranges (`^`) in `package.json` | acceptable — lockfile pins exact transitive versions |
| Dependency counts | prod 155, dev 412, optional 64 (575 total) | `npm audit --json` metadata |
| Single package manager | npm only (no yarn/pnpm lock) | `ls *.lock*` → only `package-lock.json` |
| `packageManager` pin | None | `package.json` has no `packageManager` field |

Determinism = **PASS**. The caret ranges are mitigated by `npm ci` ignoring them in favor
of the lockfile. Recommend adding a `packageManager` field for Corepack-level pinning.

---

## 2. Known vulnerabilities (npm audit, 2026-06-27)

```
5 vulnerabilities (1 moderate, 4 high)
prod deps: 155 · dev deps: 412 · total: 575
Affected packages: next, postcss, glob, @next/eslint-plugin-next, eslint-config-next
```

**Installed `next` = 14.2.35.** npm flags the `next` package against an advisory range of
`9.3.4-canary.0 - 16.3.0-canary.5` covering **14 advisories**, including (security-relevant
to this app in bold):
- **GHSA-c4j6-fc7j-m34r — SSRF via WebSocket upgrades** (app proxies to Hermes + Supabase WSS)
- **GHSA-36qx-fr4f-26g5 — Middleware/Proxy bypass (Pages Router + i18n)** (auth gate is `middleware.ts`)
- **GHSA-3g8h-86w9-wvmq — Middleware/Proxy redirects cache-poisoned**
- **GHSA-ffhc-5mcf-pf4q — XSS in App Router with CSP nonces**
- **GHSA-gx5p-jg67-6x7h — XSS in beforeInteractive scripts**
- GHSA-9g9p-9gw9-jx7f / GHSA-h64f-5h5j-jqjh / GHSA-3x4c-7xq6-9pq8 — Image Optimizer DoS / disk-cache exhaustion
- GHSA-h25m-26qc-wcjf / GHSA-q4gf-8mx6-v5v3 / GHSA-8h8q-6873-q5fj — RSC DoS
- GHSA-ggv3-7p47-pfv8 — HTTP request smuggling in rewrites
- GHSA-vfv6-92ff-j949 / GHSA-wfc6-r584-vfw7 — RSC cache poisoning
- Transitive: `postcss <8.5.10` (GHSA-qx2v-qp2m-jg93, moderate XSS in stringify)

npm's suggested remediation is `npm audit fix --force` → `next@16.2.9` (a **major** bump,
breaking). The right move is a controlled upgrade to the latest patched **14.2.x** (or a
deliberate, tested major bump), not a blind `--force`.

## [HIGH] Exploitable framework dependencies present and not blocked by CI
- **Area / Affected:** `next@14.2.35` + transitive `postcss`/`glob`; `ci.yml:40` non-blocking audit
- **Description:** 4 high + 1 moderate advisories in the production framework, several touching the auth/middleware/SSRF surfaces this app actually uses; CI audit is `|| true`.
- **Impact:** DoS, SSRF, middleware/auth bypass, cache poisoning, XSS — depending on config — shippable to prod with no pipeline stop. For an app holding candidate PII + OAuth mailbox tokens, the SSRF and middleware-bypass classes are the most concerning.
- **Likelihood:** High (public advisories; partial mapping to real attack surface; exploitability of some is config-dependent — e.g. i18n/Pages Router for the bypass).
- **Reproduction:** `npm audit --audit-level=high` → "5 vulnerabilities (1 moderate, 4 high)"; `node -e "require('./node_modules/next/package.json').version"` → 14.2.35.
- **Evidence:** npm audit output 2026-06-27; `ci.yml:40`.
- **Recommended fix:** Upgrade `next` to the latest patched release on a supported line; re-run typecheck/test/build; remove `|| true` from the CI audit so high+ fails the build; record any consciously-accepted advisory in an allowlist with justification + expiry.
- **Tests to add:** Blocking `npm audit --audit-level=high` CI job; regression test for `middleware.ts` auth gate after the bump.
- **Status:** OPEN
- **Owner:** Tony
- **Residual risk:** High until upgraded and the gate is made blocking.

## [MEDIUM] No continuous SCA / automated dependency updates
- **Area / Affected:** `.github/` — no `dependabot.yml`, no Renovate, no Snyk/Trivy SCA job
- **Description:** The only dependency check is the (non-blocking, never-run) `npm audit` step. There is no Dependabot config (`find .github` → only `workflows/`), no automated update PRs for npm deps **or GitHub Actions**, and no third-party SCA.
- **Impact:** New CVEs are not surfaced until someone manually runs `npm audit`; deps and actions drift and rot; no managed remediation pipeline. Fails NIST SSDF PW.4 / RV.1.
- **Likelihood:** Medium.
- **Reproduction:** `find .github -type f` → only `workflows/ci.yml`, `workflows/codeql.yml`.
- **Evidence:** filesystem.
- **Recommended fix:** Add `.github/dependabot.yml` for `npm` and `github-actions` ecosystems (weekly, grouped). Optionally add a scheduled SCA (Trivy/Snyk) as a blocking PR check.
- **Tests to add:** Verify Dependabot opens PRs after onboarding (operational check).
- **Status:** OPEN
- **Owner:** Tony
- **Residual risk:** Medium.

## [MEDIUM] No SBOM generated or published
- **Area / Affected:** whole build; `find . -iname '*sbom*' -o -iname '*.spdx*' -o -iname '*cyclonedx*'` → none
- **Description:** No SBOM (CycloneDX/SPDX) is produced at build time or attached to releases. With 575 dependencies there is no machine-readable component inventory for downstream CVE matching or for customers/auditors.
- **Impact:** Cannot answer "are we affected by CVE-X?" quickly; fails NIST SSDF PS.3 / typical enterprise + EO 14028 expectations.
- **Likelihood:** Medium (process gap, not exploit).
- **Reproduction:** filesystem search → none.
- **Evidence:** find output.
- **Recommended fix:** Add a CI step (`npm sbom --sbom-format cyclonedx` or `@cyclonedx/cyclonedx-npm`) to emit and archive an SBOM per build; attach it to releases.
- **Status:** OPEN
- **Owner:** Tony
- **Residual risk:** Medium.

## [MEDIUM] No build provenance / artifact attestation / signing
- **Area / Affected:** `ci.yml`, `vercel.json`; `grep -ri 'provenance|slsa|cosign|attestation' .github/` → none
- **Description:** No SLSA provenance, no `actions/attest-build-provenance`, no signed commits/tags required, no signed artifacts. Build integrity is unverifiable; there is no cryptographic link from source commit → deployed artifact.
- **Impact:** A tampered build or a malicious deploy cannot be detected after the fact; no chain of custody. Fails SLSA L1+ and NIST SSDF PS.2.
- **Likelihood:** Low-Medium.
- **Reproduction:** grep over `.github/`.
- **Evidence:** grep output (none).
- **Recommended fix:** Require signed commits/tags (branch protection); if/when a CI build artifact exists, add `actions/attest-build-provenance`; record the deployed commit SHA in the release log (ties into `RELEASE_AND_ROLLBACK_REPORT.md`).
- **Status:** OPEN
- **Owner:** Tony
- **Residual risk:** Medium.

## [MEDIUM] GitHub Actions pinned to mutable tags, not SHAs
- **Area / Affected:** `ci.yml` (`actions/checkout@v4`, `actions/setup-node@v4`, `gitleaks/gitleaks-action@v2`), `codeql.yml` (`github/codeql-action/*@v3`)
- **Description:** Actions are referenced by floating major tags; a retag or upstream compromise alters CI behavior silently on a runner that holds `GITHUB_TOKEN` (and any future deploy creds).
- **Impact:** CI supply-chain tampering vector. CIS/SLSA recommend full-SHA pinning.
- **Likelihood:** Low-Medium.
- **Reproduction:** read both workflows.
- **Evidence:** `ci.yml:16,19,43`; `codeql.yml:23,26,31,33`.
- **Recommended fix:** Pin to 40-char SHAs (comment the version); let Dependabot `github-actions` bump them.
- **Status:** OPEN (also in `CICD_REVIEW.md`)
- **Owner:** Tony
- **Residual risk:** Medium.

## [LOW] Secret material handling in repo — clean, with hygiene gaps
- **Area / Affected:** `.gitignore` (`.env`, `.env*.local`); `.env.local.example` (tracked, placeholders); no tracked real env file
- **Description:** No real secrets are tracked: `git ls-files | grep env` → only `.env.local.example`; `.env.local` is untracked (`git ls-files --error-unmatch .env.local` → not found); a `git grep` for service-role keys / `sk-…` / private-key headers over tracked non-doc files returned nothing. `.gitignore` correctly excludes `.env`, `.env*.local`, `*.pem`. Gaps: gitleaks has never run (no remote) so this is unverified by tooling, and there is no `.gitleaks.toml` to allowlist the example placeholders (risk of future noisy/ignored scans).
- **Impact:** Low today; the **verification** (automated secret scan) is what's missing, not evidence of a leak.
- **Likelihood:** Low.
- **Reproduction:** commands above.
- **Evidence:** `git ls-files`, `.gitignore` content, git-grep (no hits).
- **Recommended fix:** Once a remote exists, run a full-history gitleaks scan (`--no-git` over the working tree + history) and capture the report; add `.gitleaks.toml`.
- **Status:** OPEN (verification pending) — no leak found in manual scan
- **Owner:** Tony
- **Residual risk:** Low.

---

## Sub-gate scorecard (supply chain)

| Sub-check | Status | Evidence |
|---|---|---|
| Deps pinned / deterministic install | **PASS** | `npm ci` + lockfile v3 tracked |
| No high/critical vulnerable deps | **FAIL** | 4 high + 1 moderate (next/postcss) |
| Vuln gate blocking in CI | **FAIL** | `npm audit ... || true` |
| Continuous SCA (Dependabot/Renovate) | **FAIL** | none configured |
| SBOM generated/published | **FAIL** | none |
| Build provenance / attestation / signing | **FAIL** | none |
| Action integrity (SHA pinning) | **FAIL** | mutable tags |
| Secret scanning (gitleaks) | UNKNOWN | configured; license/scope caveats; never ran |
| No secrets committed | PASS (manual) | git-grep + `git ls-files` clean; not tool-verified |
| SAST (CodeQL) | UNKNOWN | configured; never ran (no remote) |

**Supply-chain verdict: FAIL.** One blocking HIGH (exploitable framework deps not gated)
plus multiple MEDIUM NIST-SSDF/SLSA gaps (no SCA, SBOM, provenance, SHA pinning).
