# Coverage Report — MSourcing ("hermes-sourcing")

- **Gate:** Gate 9 — QA
- **Date:** 2026-06-27
- **Method:** No coverage instrumentation exists in the repo (`grep -E "c8|nyc|istanbul|vitest|jest|coverage" package.json` → none). This report uses an **import-graph proxy**: a `src/` module is counted "exercised" only if at least one `tests/*.mts` suite imports it. This **over-states** real coverage (importing a module ≠ exercising all its branches) and **cannot** measure line/branch %. Per the binding rule, **un-instrumented coverage = UNKNOWN, not PASS.**

---

## 1. Headline

- **Quantified line/branch coverage: UNKNOWN** (no tool run; none installed).
- **Modules exercised by ≥1 suite (proxy): 23 of 34 `src/lib/*.ts`** (~68% of `src/lib` files touched at the file level — *not* line coverage).
- **API route handlers exercised at runtime: 0 of 8** (`src/app/api/**/route.ts`).
- **Auth/OAuth route handlers exercised at runtime: 0 of 6** (`src/app/auth/**/route.ts`).
- **Middleware exercised: 0** (`src/middleware.ts`).
- **React components/pages tested: 0** (no `.tsx` is imported by any test; `security-audit.mts` only *reads* `.tsx` as text).

---

## 2. `src/lib` module coverage (import proxy)

### Exercised by ≥1 suite (23)
`fleet`, `seed`, `types`, `utils`, `humanizer`, `mock-ai`, `metrics`, `scoring`, `skills`, `confidential`, `rules`, `i18n`, `roles`, `rbac`, `providers`, `floor`, `linkedin-policy`, `api/url`, `api/validate`, `api/hermes-proxy`, `ai/hermes`, `ai/provider`, `store` (**memory/soul slice only** — `memory-soul.mts`).

### NOT exercised by any suite (11) — coverage gap
| Module | LOC | Sensitivity | Why it matters |
|---|---|---|---|
| `store.ts` (full) | 3069 | **HIGH** | only memory/soul tested; persistence (localStorage / Supabase 600ms debounced upsert), state migrations (`version`), human-approval gate, conflict handling — untested |
| `supabase/workspace.ts` | 82 | **HIGH** | tenant/workspace scoping — no isolation test |
| `supabase/server.ts` | 72 | **HIGH** | service-role / SSR client construction |
| `supabase/client.ts` | — | MED | browser client |
| `supabase/config.ts` | — | MED | env wiring / demo-mode detection |
| `email-oauth.ts` | 204 | **HIGH** | Gmail/Graph send + OAuth mailbox tokens |
| `ai/hermes-runtime.ts` | 102 | MED | runtime branch of Hermes integration |
| `domain-verification.ts` | 34 | MED | sender-domain verification gate for outreach |
| `integrations.ts` | — | MED | integration registry/state |
| `floor3d.ts` | — | LOW | 3D scene math (perf, not data) |
| `sound.ts`, `scroll-lock.ts` | — | LOW | UI utilities |

> The single largest gap by LOC is `store.ts` (3069 lines, the app's central state engine) with only its memory/soul slice covered.

---

## 3. API surface coverage (runtime)

| Handler | LOC | Auth/RBAC logic in code | Runtime test? |
|---|---|---|---|
| `api/hermes/chat/route.ts` | 275 | bearer, RBAC per task, SSRF, mock fallback | **NO** |
| `api/outreach/send/route.ts` | 190 | `getUser()` 401, `can(role,"outreach")` 403, workspace/seat 403 (lines 64–87) | **NO** |
| `api/hermes/proxy/route.ts` | 145 | path allow-list, SSRF | **NO** |
| `api/keys/route.ts` | 79 | `ensure_workspace` rpc, insert w/ `workspace_id` | **NO** |
| `api/keys/test/route.ts` | — | key test | **NO** |
| `api/intake/route.ts` | 75 | zod validation | **NO** |
| `api/auth/demo-login/route.ts` | 48 | demo bypass | **NO** |
| `api/health/route.ts` | — | liveness | **NO** |
| `auth/{callback,google,google/callback,microsoft,microsoft/callback,signout}/route.ts` (6) | — | OAuth flows | **NO** |
| `src/middleware.ts` | — | auth gate / redirect | **NO** |

**0/15 server entry points executed by tests.** The helper functions they call (`rbac.can`, `url.isAllowedHermesUrl`, `hermes-proxy.isAllowedHermesPath`, `validate` zod schemas) are unit-tested in isolation, but their **composition inside the handlers** (ordering, early-returns, error bodies, status codes) is unverified. `security-audit.mts` provides a **static text-scan** of these files only (regex over source), not execution.

---

## 4. Critical-area coverage scorecard

| Critical area | Helper unit tests | Runtime/behavioral tests | Verdict |
|---|---|---|---|
| **Auth (login gate, demo bypass)** | none | none | **GAP — UNKNOWN** |
| **Authz / RBAC** | yes (`rbac-keys`, `admin-config`) | none (handler wiring) | **PARTIAL** |
| **Hermes proxy / SSRF** | yes (`api-validation`, `hermes-proxy`, `security-audit`) | none (route flow) | **PARTIAL** |
| **Guardrails / never-auto-send** | partial (`guardrails`, `audit-fixes`; gate lives in `store.ts`) | none | **PARTIAL** |
| **Data handling / persistence** | memory/soul slice only | none | **GAP** |
| **Tenant isolation (multi-workspace)** | none | none | **GAP — UNKNOWN** |
| **OAuth mailbox tokens** | none | none | **GAP** |
| **Confidential/PII rules** | yes (`rules-confidential`, 42) | none (UI/route) | **PARTIAL** |
| **Mock AI / ReDoS safety** | yes (`mock-ai`, `security-redos`) | n/a | **OK** (timing-flaky, FLK-01) |
| **Scoring / metrics / fleet** | yes (149 + 43) | n/a | **OK** |
| **UI components / 19 pages** | none | none (no E2E) | **GAP** |
| **Accessibility (WCAG 2.2 AA)** | none | none | **GAP (Gate 3)** |
| **Performance / load** | none | none | **GAP (Gate 10)** |

---

## 5. How to instrument (recommended)

1. Add dev dep `c8`. Add script: `"coverage": "c8 --reporter=text-summary --reporter=html --src src npm run test"` (or wrap the existing `tsx` chain). Publish line/branch %.
2. Set an initial CI threshold on `src/lib` (e.g. `--lines 60 --branches 50`) and ratchet up; fail CI below threshold.
3. Add the P0 runtime tests from `QA_TEST_PLAN.md §5` so route handlers, middleware, tenant isolation, and OAuth show up in the numbers.
4. Re-run and replace this report's "UNKNOWN" headline with measured figures.

---

## 6. Verdict

Quantified coverage is **UNKNOWN** (no instrumentation). Import-proxy shows strong `src/lib` pure-function coverage but **zero runtime coverage of every server entry point and the auth gate**, and **zero coverage of tenant isolation and OAuth tokens**. This is the basis for the Gate-9 FAIL and the HIGH finding in `QA_TEST_PLAN.md §7`.
