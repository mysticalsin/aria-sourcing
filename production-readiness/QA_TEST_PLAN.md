# QA Test Plan — MSourcing ("hermes-sourcing")

> SUPERSEDED by `STATUS.md` 2026-07-10 for current release posture. Historical 2026-06-27 evidence may contain stale stack versions, suite counts, migration ranges, and verdicts.


- **Gate:** Gate 9 — QA
- **Author:** QA Automation Engineer (production-readiness review)
- **Date:** 2026-06-27
- **Repo:** `/Users/tony/Library/CloudStorage/OneDrive-MantuGroup/Documents/TEST/MSourcing` (branch `main`, **working tree DIRTY** — see below)
- **Self-description:** package.json — "MVP demo, mock integrations, synthetic data."
- **Supersedes:** the QA row in `RELEASE_GATE_MATRIX.md` (which recorded "20 suites pass, PARTIAL"). Current tree has **22 suites**. This plan + `QA_TEST_RESULTS.md` + `COVERAGE_REPORT.md` + `FLAKY_TEST_REGISTER.md` are the authoritative Gate-9 artifacts.

> Working-tree state at audit time: `git status --porcelain` → **73 modified tracked files, 0 staged, 0 deleted, 86 untracked** (incl. `.env.production.example`, `docs/`, `backups/`, many `*.png` smoke screenshots, `DEPLOYMENT.md`). Last commit `35ce313 "Guardrails & Aria — the adjustable agent brain in Settings"`. **The suite was run against this dirty tree as-is.**

---

## 1. Exec summary

The project ships a **bespoke assertion harness**: 22 `tests/*.mts` files run sequentially via `tsx` (no Jest/Vitest/Playwright/coverage tooling in `package.json`). The four scripted quality gates all pass on the current tree:

| Gate command | Result | Evidence |
|---|---|---|
| `npm run typecheck` (`tsc --noEmit`) | **PASS** exit 0 | `QA_TEST_RESULTS.md §2` |
| `npm run test` (22 suites) | **PASS** — 705 assertions, 0 failed | `QA_TEST_RESULTS.md §3` |
| `npm run lint` (`next lint`) | **PASS** — "No ESLint warnings or errors" | `QA_TEST_RESULTS.md §4` |
| `npm run build` (`next build`) | **PASS** exit 0 (warnings) | `QA_TEST_RESULTS.md §5` |

**Gate-9 verdict: FAIL.** The green suite is real and useful, but it is almost entirely **pure-function unit testing of `src/lib/*` helpers**. The most sensitive code paths — the auth gate (`src/middleware.ts`), every API route handler (`src/app/api/**/route.ts`, `src/app/auth/**/route.ts`), tenant isolation (`src/lib/supabase/workspace.ts`), and OAuth mailbox-token handling (`src/lib/email-oauth.ts`) — are **never executed by any test** (verified: no test imports/invokes a `GET`/`POST` handler; `route` handler auth/RBAC is only checked by regex static-scan in `security-audit.mts`). There is **no coverage instrumentation**, so the true exercised-code percentage is **unknown**. There are **no E2E, no automated a11y, and no load/perf tests** in the suite. Per the binding rule "untested = FAIL or UNKNOWN, never PASS," and with an open **HIGH** coverage gap on auth/authz/tenant-isolation, **Gate 9 cannot PASS**.

---

## 2. Scope

### In scope (this gate)
- Run + record the four scripted gates (typecheck, test, lint, build) with real output.
- Map the 22 suites to the source modules they exercise (coverage-by-import proxy).
- Identify missing critical tests on auth, authz/RBAC, Hermes proxy/SSRF, guardrails, data handling, tenant isolation, OAuth tokens.
- Identify flaky / environment-sensitive tests.

### Out of scope (owned by other gates, cross-referenced here)
- Deep security verdicts — `SECURITY_REVIEW.md`, `API_SECURITY_REPORT.md`, `THREAT_MODEL.md`.
- Data/RLS/tenant proof — Gate 5 / `DATA_FLOW.md`.
- Performance/load — Gate 10 / `FRONTEND_PERFORMANCE_REPORT.md`.
- Accessibility — Gate 3 / `ACCESSIBILITY_REPORT.md`.
- Infra/CI/CD — Gates 6/8.

---

## 3. Test environment

| Item | Value |
|---|---|
| Local Node | v22.22.3 |
| Local npm | 10.9.8 |
| CI Node | 20 (`.github/workflows/ci.yml:21`) |
| Runner | `tsx ^4.22.4` (devDependency); sequential `&&` chain in `package.json` `scripts.test` |
| Test type | Hand-rolled `ok(name, cond)` assertions; each suite prints `RESULT <name>: N passed, M failed` and sets `process.exitCode=1` on any failure |
| Coverage tool | **none** (no c8/nyc/istanbul/vitest/jest) |
| E2E tool | **none in suite** (Playwright screenshots in repo root are manual/ad-hoc — `EVIDENCE_INDEX.md`) |

> **Local reproducibility caveat:** under the default Claude Code command sandbox, `tsx` fails at startup with `EPERM` creating its IPC pipe (`listen EPERM … /tmp/claude-501/tsx-501/<pid>.pipe`) — a unix-socket sandbox restriction, **not** a product defect. The suite was run with the sandbox bypassed. CI (Linux, no sandbox) is unaffected. Tracked as a LOW finding (QA-09).

---

## 4. Suite inventory (22 suites) and what each exercises

| # | Suite | Source under test (by import) | Test character |
|---|---|---|---|
| 1 | `fleet.mts` | `lib/fleet`, `seed`, `types`, `utils` | unit (allocation logic) |
| 2 | `humanizer.mts` | `lib/humanizer` | unit (AI-tell stripping) |
| 3 | `mock-ai.mts` | `lib/mock-ai`, `seed` | unit (deterministic mock AI) |
| 4 | `mantu-intake.mts` | `lib/mock-ai` | unit (intake parse) |
| 5 | `security-redos.mts` | `lib/mock-ai` | **timing** (ReDoS guard, `<1000ms`) + classifier |
| 6 | `scoring-metrics.mts` | `lib/metrics`, `scoring`, `seed`, `types` | unit (149 assertions) |
| 7 | `skills.mts` | `lib/skills`, `seed`, `types` | unit |
| 8 | `rules-confidential.mts` | `lib/confidential`, `rules`, `seed`, `types` | unit (PII/confidential rules) |
| 9 | `roles-i18n.mts` | `lib/i18n`, `roles`, `mock-ai`, `seed` | unit |
| 10 | `rbac-keys.mts` | `lib/rbac`, `providers` | unit (`can(role,perm)` matrix) |
| 11 | `api-validation.mts` | `lib/api/url`, `api/validate` | unit (zod schemas, URL allow-list) |
| 12 | `floor.mts` | `lib/floor`, `seed` | unit |
| 13 | `guardrails.mts` | `lib/seed` | unit (guardrail defaults) |
| 14 | `admin-config.mts` | `lib/rbac`, `seed`, `types` | unit (46 assertions) |
| 15 | `hermes-live.mts` | `lib/ai/hermes`, `mock-ai`, `seed`, `types` | unit (live/mock branch, **no network**) |
| 16 | `linkedin-policy.mts` | `lib/linkedin-policy` | unit (policy compliance) |
| 17 | `hermes-proxy.mts` | `lib/api/hermes-proxy` | unit (path allow-list) |
| 18 | `security-audit.mts` | **static text-scan of `./src`** + `api/url`, `api/hermes-proxy` | **static invariants** (regex over source) |
| 19 | `chat.mts` | `lib/ai/hermes`, `seed`, `types`, `utils` | unit (chat reducer) |
| 20 | `audit-fixes.mts` | `lib/ai/hermes`, `mock-ai`, `seed`, `types` | unit (regression of audit fixes) |
| 21 | `memory-soul.mts` | `lib/store` (memory/soul slice), `seed`, `types` | unit (uses `Math.random` for ids) |
| 22 | `ai-provider.mts` | `lib/ai/provider`, `seed`, `types` | unit |

**Security subset** (`npm run test:security`): suites 18, 5, 10, 11, 13, 16 — a documented fast lane; all included in the full run above.

---

## 5. Risk-based test priorities (what SHOULD exist)

Ranked by data-sensitivity × current-coverage-gap.

### P0 — currently UNTESTED at runtime (sensitive)
1. **Auth gate** `src/middleware.ts` — redirect-to-`/login` in live mode, open-access in demo mode. No test loads the middleware or asserts an unauthenticated request is redirected.
2. **API route authz** `src/app/api/{keys,keys/test,outreach/send,intake,hermes/chat,hermes/proxy}/route.ts` — handlers contain `supabase.auth.getUser()`, `can(role, perm)`, workspace/RLS checks (e.g. `outreach/send/route.ts:67,73,87`), but **no test invokes the handler**. 401/403/200 branches unproven behaviorally.
3. **Tenant isolation** `src/lib/supabase/workspace.ts` (82 LOC, 0 tests) — no test proves workspace A cannot read/write workspace B's candidates/keys/outreach. (Also Gate 5.)
4. **OAuth mailbox tokens** `src/lib/email-oauth.ts` (204 LOC, 0 tests) — Gmail/Graph send + token handling; no test for token absence/expiry/scope errors.
5. **Secret vault** — `api/keys/route.ts` insert path; only a regex static-scan asserts the select doesn't return `secret`. No behavioral test that a key, once stored, is never echoed to a non-service-role caller.

### P1 — partially covered (helper unit-tested, wiring untested)
6. **RBAC** — `rbac.ts` matrix unit-tested (`rbac-keys.mts`, `admin-config.mts`), but enforcement inside each route handler is not exercised.
7. **SSRF / Hermes proxy** — `url.ts` + `hermes-proxy.ts` allow-lists unit-tested (`api-validation.mts`, `hermes-proxy.mts`, `security-audit.mts`); the actual `hermes/{chat,proxy}/route.ts` request flow (bearer injection, RBAC per task, mock fallback) is not invoked.
8. **Guardrails / human-approval gate** — `humanApprovalGate` lives in `store.ts` (3069 LOC); only the memory/soul slice is tested (`memory-soul.mts`). The never-auto-send invariant is not directly asserted by an executable test.
9. **Data persistence** — `store.ts` localStorage/Supabase 600ms debounced upsert path: untested (serialization, migration `version` bumps, debounce, conflict).

### P2 — quality tiers entirely absent
10. **E2E** (login → floor → draft → approve → send happy path; demo-mode bypass). None.
11. **Automated a11y** (axe/Playwright, WCAG 2.2 AA). None (Gate 3).
12. **Load/perf/soak** (3D floor agent cap, API concurrency). None (Gate 10).
13. **React component/page tests** (19 pages, dozens of components). None.

---

## 6. Entry / exit criteria

**Entry (met):** code builds, deps installed, suite runnable (sandbox bypassed locally).

**Exit for Gate-9 PASS (NOT met):** all four scripted gates green **AND** coverage instrumented with a published threshold **AND** P0 items 1–5 covered by executed tests **AND** at least one happy-path E2E **AND** no open CRITICAL/HIGH QA finding. Current state: P0 = 0/5 executed, coverage = unmeasured, E2E = 0 → **FAIL**.

---

## 7. Findings (FINDING FORMAT)

### [HIGH] No executable test coverage of auth gate, API route authz, tenant isolation, or OAuth tokens
- **Area:** QA / test coverage of sensitive paths
- **Affected:** `src/middleware.ts`; `src/app/api/**/route.ts` (8 handlers); `src/app/auth/**/route.ts` (6 handlers); `src/lib/supabase/workspace.ts`; `src/lib/email-oauth.ts`
- **Description:** 22 suites are pure-function unit tests of `src/lib` helpers. No test imports or invokes a Next.js route handler or the middleware. `grep -rnE "export (async )?function (GET|POST|...)" tests/*.mts` → **none**. The only "route security" test (`security-audit.mts`) reads source files as text and regex-matches them — it does not execute any request.
- **Impact:** Auth bypass, broken RBAC wiring, cross-tenant data leakage, or OAuth-token mishandling could ship green. The suite's "705 passed" gives false confidence about the parts that touch real user PII / secrets.
- **Likelihood:** Medium (logic exists and looks correct in code, but regressions in wiring are invisible to the suite).
- **Reproduction:** `grep -rl "route.ts" tests/` → only `security-audit.mts` (as a text file); no handler is called.
- **Evidence:** §4–§5 above; `outreach/send/route.ts:67,73,87` (auth/RBAC/workspace logic present but untested); `wc -l email-oauth.ts=204, supabase/workspace.ts=82` both 0 tests.
- **Recommended fix:** Add handler-level tests that import each `route.ts` and call it with a mocked `NextRequest` + mocked Supabase client: assert 401 when unauthenticated, 403 when role lacks perm or seat is in another workspace, 200 on the happy path. Add a tenant-isolation test (workspace A token cannot read workspace B rows). Add `email-oauth` tests for missing/expired token and scope error.
- **Tests to add:** `tests/route-keys.mts`, `tests/route-outreach-send.mts`, `tests/route-hermes-chat.mts`, `tests/middleware-authgate.mts`, `tests/tenant-isolation.mts`, `tests/email-oauth.mts`.
- **Status:** OPEN
- **Owner:** Tony / eng
- **Residual risk:** HIGH until P0 items execute.

### [MEDIUM] No coverage instrumentation — exercised-code % is unknown
- **Area:** QA / measurement
- **Affected:** `package.json` scripts; whole repo
- **Description:** No `c8`/`nyc`/`istanbul`/`vitest`/`jest` dependency or coverage script. "705 assertions pass" is a count of assertions, not a measure of code reached. Untested modules include `store.ts` (3069 LOC, only memory/soul slice tested), `ai/hermes-runtime.ts`, `domain-verification.ts`, `integrations.ts`, `floor3d.ts`, `supabase/{client,config,server,workspace}.ts`, `sound.ts`, `scroll-lock.ts`, and all `.tsx` UI.
- **Impact:** Coverage claims cannot be verified; gate cannot prove adequacy.
- **Likelihood:** N/A (measurement gap).
- **Reproduction:** `grep -E "c8|nyc|istanbul|vitest|jest|coverage" package.json` → none.
- **Evidence:** `COVERAGE_REPORT.md`.
- **Recommended fix:** Run the suite under `c8` (`c8 --reporter=text-summary tsx ...`) and publish line/branch %; set a CI threshold (start ≥60% on `src/lib`, ratchet up).
- **Tests to add:** coverage harness + CI gate.
- **Status:** OPEN — **per rules, unmeasured = UNKNOWN, not PASS**
- **Owner:** Tony / eng
- **Residual risk:** MEDIUM.

### [MEDIUM] No E2E / no automated accessibility / no load tests in the suite
- **Area:** QA / test-tier completeness
- **Affected:** test suite
- **Description:** The repo's Playwright "evidence" is manual screenshots (`EVIDENCE_INDEX.md`, `*.png` in repo root); there is no scripted E2E, no axe/a11y run, no load test. CI runs only typecheck/lint/test/build (`.github/workflows/ci.yml:28–37`).
- **Impact:** Regressions in real user flows (login → draft → approve → send), WCAG 2.2 AA, and concurrency behavior are not caught automatically.
- **Likelihood:** Medium over time.
- **Reproduction:** `grep -E "playwright|@axe|k6|artillery|autocannon" package.json` → none.
- **Evidence:** `ACCESSIBILITY_REPORT.md` (Gate 3), `FRONTEND_PERFORMANCE_REPORT.md` (Gate 10).
- **Recommended fix:** Add one Playwright happy-path E2E (demo mode) + axe-core a11y assertions on the 6 top routes; add a smoke load test against `/api/health` and `/api/hermes/chat` mock path.
- **Status:** OPEN
- **Owner:** Tony / eng
- **Residual risk:** MEDIUM.

### [MEDIUM] Route "security tests" rely on brittle source-text regex, not behavior
- **Area:** QA / test robustness
- **Affected:** `tests/security-audit.mts`
- **Description:** Invariants like "api_keys route does not return secret" and "no `dangerouslySetInnerHTML`" are enforced by `readFileSync` + regex over concatenated source. Reformatting, a new file path, or a refactor can silently break or void the check without failing it (e.g. the `api_keys select` regex has an `||` escape hatch).
- **Impact:** Security invariants can erode while the test stays green.
- **Likelihood:** Medium (regex is whitespace-collapsed but structure-sensitive).
- **Evidence:** `tests/security-audit.mts` lines 35–58 (text-scan + `combined.replace(/\s+/g," ")`).
- **Recommended fix:** Replace text-scan invariants with behavioral handler tests (call the route, assert the response body never contains `secret`); keep the static scan only as a cheap belt-and-suspenders.
- **Status:** OPEN
- **Owner:** Tony / eng
- **Residual risk:** LOW–MEDIUM.

### [LOW] Timing-based assertion is environment-sensitive (flaky risk)
- **Area:** QA / flakiness
- **Affected:** `tests/security-redos.mts:21` (`elapsed < 1000ms`)
- **Description:** The ReDoS guard asserts a wall-clock budget. On a loaded/slow CI runner or cold JIT this can exceed 1000ms and fail spuriously even though no catastrophic backtracking occurred. See `FLAKY_TEST_REGISTER.md` FLK-01.
- **Status:** OPEN (passed this run with margin) — **watch**
- **Recommended fix:** Raise threshold to ~3000ms or assert relative scaling (2× input ≯ ~2× time) instead of absolute ms.
- **Owner:** eng
- **Residual risk:** LOW.

### [LOW] Suite not runnable under default Claude Code sandbox (tooling note)
- **Area:** QA / local repro
- **Affected:** `tsx` IPC; local dev only
- **Description:** `tsx` opens a unix-socket IPC pipe; the default sandbox denies `listen` → `EPERM`. The suite ran clean once the sandbox was bypassed. CI (Linux) unaffected.
- **Status:** ACCEPTED (environment, not product) — documented so future runners don't misread it as a failure.
- **Owner:** QA
- **Residual risk:** LOW.

---

## 8. Gate decision

**Gate 9 — QA: FAIL.** Four scripted gates green (typecheck/test/lint/build), but: one open **HIGH** (no executed coverage of auth/authz/tenant-isolation/OAuth), coverage **unmeasured (UNKNOWN)**, and no E2E/a11y/load tier. Conservative rule applies: untested sensitive paths = not PASS.
