# QA Test Results — MSourcing ("hermes-sourcing")

- **Gate:** Gate 9 — QA
- **Date / time:** 2026-06-27 ~19:55 EDT
- **Repo:** `/Users/tony/.../TEST/MSourcing`, branch `main`, **dirty tree** (73 modified, 86 untracked, 0 staged, 0 deleted; HEAD `35ce313`)
- **Toolchain:** Node v22.22.3, npm 10.9.8, `tsx ^4.22.4`. CI uses Node 20.
- **Reproduce:** from repo root run `npm run typecheck`, `npm run test`, `npm run lint`, `npm run build`.

> **Sandbox note:** under the default command sandbox, `npm run test` fails immediately with
> `Error: listen EPERM: operation not permitted /tmp/claude-501/tsx-501/<pid>.pipe` — `tsx`
> cannot bind its IPC unix socket. This is a sandbox restriction, not a test failure. Results
> below were produced with the sandbox bypassed; Linux CI is unaffected. (Finding QA-09.)

---

## 1. Summary table

| Gate | Command | Exit | Result |
|---|---|---|---|
| Type safety | `npm run typecheck` (`tsc --noEmit`) | 0 | **PASS** — no errors |
| Unit/integration suite | `npm run test` (22 suites) | 0 | **PASS** — 705 assertions, 0 failed |
| Lint | `npm run lint` (`next lint`) | 0 | **PASS** — "No ESLint warnings or errors" |
| Build | `npm run build` (`next build`) | 0 | **PASS** — compiled, 36 routes generated (2 warnings) |

All four scripted gates are green on the current tree. **This does not make Gate 9 PASS** — see coverage gap (`QA_TEST_PLAN.md §7`, `COVERAGE_REPORT.md`).

---

## 2. `npm run typecheck`

```
> hermes-sourcing@1.0.0 typecheck
> tsc --noEmit

=== TYPECHECK EXIT CODE: 0 ===
```
**PASS** — zero type errors against the dirty tree.

---

## 3. `npm run test` — 22 suites, 705 assertions, 0 failed

Raw `RESULT` lines (verbatim):

```
RESULT fleet: 43 passed, 0 failed
RESULT humanizer: 41 passed, 0 failed
RESULT mock-ai: 35 passed, 0 failed
RESULT mantu-intake: 14 passed, 0 failed
RESULT security-redos: 9 passed, 0 failed
RESULT scoring: 149 passed, 0 failed
RESULT skills: 37 passed, 0 failed
RESULT rules: 42 passed, 0 failed
RESULT roles-i18n: 17 passed, 0 failed
RESULT rbac-keys: 23 passed, 0 failed
RESULT api-validation: 17 passed, 0 failed
RESULT floor: 11 passed, 0 failed
RESULT guardrails: 11 passed, 0 failed
RESULT admin-config: 46 passed, 0 failed
RESULT hermes-live: 32 passed, 0 failed
RESULT linkedin-policy: 12 passed, 0 failed
RESULT hermes-proxy: 11 passed, 0 failed
RESULT security-audit: 15 passed, 0 failed
chat: 21 passed, 0 failed
RESULT audit-fixes: 46 passed, 0 failed
RESULT memory-soul: 38 passed, 0 failed
RESULT ai-provider: 35 passed, 0 failed
=== TEST EXIT CODE: 0 ===
```

Per-suite tally (descending):

| Suite | Passed | Suite | Passed |
|---|---|---|---|
| scoring-metrics | 149 | rbac-keys | 23 |
| admin-config | 46 | chat | 21 |
| audit-fixes | 46 | api-validation | 17 |
| fleet | 43 | roles-i18n | 17 |
| rules-confidential | 42 | mantu-intake | 14 |
| humanizer | 41 | linkedin-policy | 12 |
| memory-soul | 38 | floor | 11 |
| skills | 37 | guardrails | 11 |
| mock-ai | 35 | hermes-proxy | 11 |
| ai-provider | 35 | security-redos | 9 |
| hermes-live | 32 | security-audit | 15 |

**Total: 705 passed, 0 failed across 22 suites.** Exit 0.

> Discrepancy vs prior audit: `RELEASE_GATE_MATRIX.md` and `EVIDENCE_INDEX.md` recorded "20 suites." Current tree runs **22** (`ai-provider.mts` added; `hermes-proxy.mts` + `security-audit.mts` now in the chain). Prior docs are superseded on the count.

---

## 4. `npm run lint`

```
> hermes-sourcing@1.0.0 lint
> next lint

✔ No ESLint warnings or errors
=== LINT EXIT CODE: 0 ===
```
**PASS.**

---

## 5. `npm run build`

`next build` completed **exit 0**. 36 routes generated (static `○` + dynamic `ƒ`). Two warnings recorded:

1. **Edge Runtime warning (worth tracking):**
   ```
   ./node_modules/@supabase/supabase-js/dist/index.mjs
   A Node.js API is used (process.version at line: 27) which is not supported in the Edge Runtime.
   Import trace: @supabase/supabase-js → @supabase/ssr/createBrowserClient.js → @supabase/ssr/index.js
   ```
   The middleware (82.6 kB, runs in Edge Runtime) transitively bundles `supabase-js`, which calls `process.version`. Next emits this as a warning, not an error; build still succeeds. Flag for runtime verification on Vercel Edge — see Backend/Infra gates.

2. **Webpack cache perf warning** (`Serializing big strings (102 kiB / 250 kiB) impacts deserialization`) — cosmetic build-cache note, no action required.

Build route table (excerpt):
```
Route (app)                Size      First Load JS
○ /                        9.25 kB   333 kB
○ /login                   41.4 kB   196 kB
○ /fleet                   13.2 kB   229 kB
○ /settings                21.5 kB   246 kB
ƒ /campaigns/[id]          11.8 kB   361 kB   (largest First Load JS)
ƒ /api/* (8 handlers)      0 B       server-rendered on demand
ƒ Middleware               82.6 kB
+ First Load JS shared      87.7 kB
```
**PASS** (build succeeds). Bundle sizes are an informational input for Gate 10 (`/campaigns/[id]` and the `/` candidate routes carry the heaviest First Load JS at ~333–361 kB).

---

## 6. CI cross-check

`.github/workflows/ci.yml` runs (Node 20): `npm ci` → `typecheck` → `lint` → `test` → `build` → `npm audit --audit-level=high || true` (non-blocking) → gitleaks. The four gates above mirror CI; CI does **not** add coverage, E2E, a11y, or load steps (consistent with the gaps in `QA_TEST_PLAN.md §5 P2`). `codeql.yml` present (untracked) for SAST.

---

## 7. Verdict

Four scripted gates **PASS** with real evidence. Because the green suite does not execute the auth/authz/tenant-isolation/OAuth paths and coverage is unmeasured, **Gate 9 = FAIL** overall (one open HIGH + UNKNOWN coverage). See `QA_TEST_PLAN.md §8` and `COVERAGE_REPORT.md`.
