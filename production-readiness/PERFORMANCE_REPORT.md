# PERFORMANCE REPORT — MSourcing (Aria / "hermes-sourcing")

**Phase 10 deliverable — Performance / Reliability Engineer.** Audit date: 2026-06-27. **New document.**
Maps to **Release Gate 10 — Performance / reliability** (performance half; reliability half in
`RELIABILITY_REPORT.md`; capacity model + load-test plan in `CAPACITY_PLAN.md`).

Scope (this file): expected load profile, latency/throughput/error SLOs, server-side request
latency budgets, DB query performance + connection pooling (Supabase/PostgREST), cache behavior,
serverless function-timeout configuration, and the full-state persistence cost model. Frontend
bundle/CWV performance is owned by `FRONTEND_PERFORMANCE_REPORT.md` (Gate 3) and is **referenced,
not re-audited**, here.

**Audit-only.** No application source was modified. Evidence is repo-verified (`file:line`) or from
commands run during this audit (`npm audit`, file reads). The working tree was **dirty** at audit
time (73 modified + untracked files per `git status`, branch `main`); findings reflect the current
on-disk tree.

---

## Executive summary

There is **no performance engineering artifact in the repository**: no defined load profile, no
latency/throughput/error SLOs, no load/stress/soak test, no performance budget in CI, and no APM/RUM.
Performance has been *assumed* from demo-scale synthetic data (4 seats, ~52 candidates) and never
*measured* at production data volumes or concurrency. Per the operating rule (untested = FAIL/UNKNOWN,
never PASS), the performance half of Gate 10 cannot pass.

Beyond the missing measurements, the audit found **concrete, evidenced performance/scalability
defects in the code as written**:

1. **Whole-workspace state is re-serialized and re-uploaded on (almost) every mutation.** Live mode
   does a debounced (600 ms) full-document `upsert` of the entire `HermesState` JSONB blob to one
   Supabase row; demo mode does a **synchronous** `JSON.stringify(entireState)` to `localStorage` on
   every change. Several core arrays (`ledger`, `outreach`, `candidates`, `replies`, `bookings`,
   `memory`) are **prepended without any cap**, so the document grows unbounded and write/read cost
   grows linearly with account age. This is the dominant scalability ceiling.
2. **A 30 s upstream `AbortSignal.timeout` is configured, but no `maxDuration` is set for any route**,
   and `vercel.json` declares **no `functions` block**. On Vercel the platform function timeout
   (default ≈10–15 s) is *shorter* than the in-code 30 s abort, so long Hermes/cloud-LLM calls and
   SSE streams are killed by the platform before the app's own timeout/cleanup runs — an undefined,
   plan-dependent failure mode rather than a deliberate budget.
3. **No caching of any read path.** `loadRemoteState` re-downloads the entire workspace JSONB on every
   page load; the health probe is `force-dynamic` + `no-store`; there is no ISR/edge cache, no
   `Cache-Control` on data responses, and no in-memory memoization of Supabase reads. Every recruiter
   tab pull is a full round-trip + full-document transfer.
4. **A known HIGH-severity Next.js availability advisory is unpatched** (DoS via Server Components and
   the Image Optimization API) — directly relevant to throughput/availability under load.

With demo data the console *feels* fast; items 1–3 are **latent scalability defects that bite at
production data volume and multi-recruiter concurrency, not at demo scale**. None reach CRITICAL on
the security-weighted rubric, but the combination of open MEDIUM/HIGH performance defects plus
**entirely unmeasured load behavior** makes this half of the gate **not releasable**.

### Gate 10 (performance half): **FAIL** (open HIGH/MEDIUM defects) **+ UNKNOWN** (load/SLOs unmeasured)
- Verified-present (good): upstream calls to Hermes & cloud LLMs are time-bounded by
  `AbortSignal.timeout(30_000)`; proxy enforces a 1 MB request-body cap (413); API bodies are
  size-capped via `validateBody({ maxBytes })`; production build compiles (per `FRONTEND_PERFORMANCE_REPORT.md`).
- Open defects (HIGH): unbounded full-state persistence blob; unpatched Next.js DoS advisory.
- Open defects (MEDIUM): function-timeout misconfiguration (30 s abort > platform default, no
  `maxDuration`); no read caching; no DB pool/PostgREST capacity verification; no perf budget in CI.
- Unverifiable (UNKNOWN — blocked on a running/deployed instance + load harness): p50/p95/p99
  latency, throughput ceiling, error rate under load, Supabase query plans/index coverage, pooler
  saturation, soak/leak behavior. Test plan in `CAPACITY_PLAN.md`.

---

## Evidence base

| Item | Evidence |
|---|---|
| No SLOs / load profile / perf budget | No such file anywhere under repo; `scripts/` holds only `backup.sh`, `restore-drill.sh`, `local-supabase-up.sh`; no k6/artillery/autocannon/lighthouse in `package.json` or `tests/` (grep returned none) |
| No perf/load step in CI | `grep -niE "load|perf|lighthouse|k6|bench|soak|stress" .github/workflows/ci.yml` → none |
| Upstream timeout (Hermes proxy) | `src/lib/api/hermes-proxy.ts:11` `HERMES_PROXY_TIMEOUT_MS = 30_000`; applied at `src/app/api/hermes/proxy/route.ts` via `AbortSignal.timeout(HERMES_PROXY_TIMEOUT_MS)` |
| Upstream timeout (chat / cloud LLM) | `src/app/api/hermes/chat/route.ts` `UPSTREAM_TIMEOUT_MS = 30_000`; both the cloud-provider branch and the Hermes branch use `AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)` |
| No `maxDuration` / `functions` config | `grep -nE "maxDuration\|functions\|memory\|cron" vercel.json` → none; `grep -rnE "maxDuration\|export const runtime" src/` → only `export const dynamic = "force-dynamic"` in `src/app/api/health/route.ts:12` |
| Request-body caps | proxy 1 MB hard cap → 413 (`hermes/proxy/route.ts`); `validateBody({ maxBytes })`: chat 32 000, outreach 100 000, intake 64 000, keys/test 8 000 |
| Full-state persistence (live) | `src/lib/supabase/workspace.ts` `saveRemoteState` → `supabase.from("workspace_state").upsert({ workspace_id, state, updated_at }, { onConflict: "workspace_id" })` — one row, whole document |
| Debounce + synchronous local persist | `src/lib/store.ts:408-417` — 600 ms `setTimeout` debounce in live mode; `window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))` synchronous in demo |
| Uncapped state arrays | `src/lib/store.ts` prepends with no `.slice` cap: `ledger` (857, 939, 1781), `outreach` (614, 730), `candidates` (574, 1848), `replies` (1071), `bookings` (1191), `memory` (2587). Only `activities` is capped (`.slice(0, 300)` global / `.slice(0, 80)` per-campaign at 449/453) |
| Per-request Supabase clients | `src/lib/supabase/server.ts` — `getServerSupabase()` / `getServiceSupabase()` build a fresh client per invocation (PostgREST HTTP; no app-managed PG pool) |
| Read path uncached | `loadRemoteState` selects the full `workspace_state.state` on every mount (`workspace.ts`); health route `no-store` + `force-dynamic` (`health/route.ts`) |
| Single region | `vercel.json` `"regions": ["cdg1"]` (no multi-region/failover) |
| Next.js availability advisory | `npm audit --omit=dev` → HIGH "Next.js Vulnerable to Denial of Service with Server Components" + "DoS in the Image Optimization API" (advisories GHSA-8h8q-6873-q5fj, GHSA-h64f-5h5j-jqjh) on `next@^14.2.35` |
| Build compiles | `FRONTEND_PERFORMANCE_REPORT.md` — `npm run build` compiled successfully (Next 14.2.35); chart routes First Load JS ~330–361 kB |

---

## Findings

## [HIGH] Unbounded whole-state document is re-serialized and persisted on nearly every mutation
- **Area:** Server-side persistence / scalability
- **Affected:** `src/lib/supabase/workspace.ts` (`saveRemoteState`); `src/lib/store.ts:400-417` (persist effect), `:342-358` (`loadState`), uncapped prepends at `:574,614,730,857,939,1071,1191,1781,1848,2587`
- **Description:** The entire `HermesState` (campaigns, candidates, outreach, replies, bookings, ledger, memory, activities, seats, settings, skills…) is held as one object and persisted as one JSONB row keyed by `workspace_id`. Every state-changing action triggers a debounced (600 ms, live) or synchronous (demo) re-serialization and write of the **whole** document; on load the **whole** document is re-downloaded. Most growth arrays have no size cap — `ledger`, `outreach`, `candidates`, `replies`, `bookings`, `memory` are unbounded `[new, ...prev]` prepends.
- **Impact:** Write amplification and transfer cost grow O(n) with account lifetime. At production volumes (thousands of candidates / ledger rows) each save uploads a multi-MB blob and each page load downloads it, inflating TTFB/INP, Supabase egress, and Postgres TOAST/write churn; a burst of actions queues large repeated upserts of an ever-larger blob. Demo mode additionally blocks the main thread on a synchronous `JSON.stringify` of the full state on every change (also flagged in `FRONTEND_PERFORMANCE_REPORT.md`).
- **Likelihood:** High at production data scale; negligible at demo scale.
- **Reproduction (test to add):** Seed a workspace to ~5 000 candidates + ~20 000 ledger rows, measure `saveRemoteState` payload size, upsert latency, and `loadRemoteState` transfer + parse time; compare to the demo-scale baseline.
- **Evidence:** see Evidence base rows "Full-state persistence", "Debounce", "Uncapped state arrays".
- **Recommended fix:** Move high-cardinality entities (candidates, ledger, outreach, replies, bookings) to normalized tables with pagination + RLS and query by page/filter, instead of one JSONB blob; or, as an interim, cap persisted arrays and split the document. Add a payload-size guard and a metric on save size.
- **Tests to add:** persistence-cost benchmark at 1×/10×/100× demo data; assert save payload < budget and load+parse < budget.
- **Status:** OPEN — **Owner:** Tony — **Residual risk:** High until storage model changes; this is the primary capacity ceiling (see `CAPACITY_PLAN.md`).

## [HIGH] Unpatched Next.js advisories include availability (DoS) issues
- **Area:** Dependency / availability
- **Affected:** `package.json` `"next": "^14.2.35"`; resolved tree per `npm audit`
- **Description:** `npm audit --omit=dev` reports active Next.js advisories, including **HIGH** "Denial of Service with Server Components" (GHSA-8h8q-6873-q5fj) and "DoS in the Image Optimization API" (GHSA-h64f-5h5j-jqjh), plus cache-poisoning and SSRF-on-WebSocket-upgrade advisories. The fix path (`npm audit fix --force`) wants `next@16.x` — a major upgrade.
- **Impact:** A remote attacker can degrade or exhaust the serving function (availability) without authentication; cache-poisoning advisories can corrupt responses under CDN caching. Directly relevant to throughput/error-rate SLOs.
- **Likelihood:** Medium (public advisories, network-reachable once deployed).
- **Reproduction:** `npm audit --omit=dev` (run during this audit) lists the advisories; CI `npm audit` is non-blocking (`CICD_REVIEW.md`).
- **Evidence:** `npm audit --omit=dev` output (this audit) — see Evidence base.
- **Recommended fix:** Plan the Next.js upgrade to a patched line; until then, make CI `npm audit` blocking for HIGH+ and document compensating controls (WAF/rate limit) for the DoS vectors.
- **Tests to add:** CI gate that fails on HIGH+ advisories in production deps.
- **Status:** OPEN — **Owner:** Tony — **Residual risk:** High while unpatched and CI audit non-blocking. (Cross-ref `SUPPLY_CHAIN_SECURITY_REPORT.md`.)

## [MEDIUM] Serverless function-timeout misconfiguration: 30 s app abort exceeds platform default; no `maxDuration`
- **Area:** Serverless config / latency budget
- **Affected:** `vercel.json` (no `functions` block); `src/app/api/hermes/chat/route.ts` (`UPSTREAM_TIMEOUT_MS = 30_000`); `src/lib/api/hermes-proxy.ts:11` (`HERMES_PROXY_TIMEOUT_MS = 30_000`)
- **Description:** The Hermes/cloud-LLM routes bound upstream calls at 30 s, but no `export const maxDuration` is declared and `vercel.json` has no `functions` entry, so the Vercel platform function timeout applies (≈10 s Hobby / ≈15 s default; plan-dependent). The platform will terminate the function before the in-code 30 s abort fires, cutting off long completions and the SSE stream mid-flight, returning a generic platform 504 rather than the app's structured `{ ok:false }` fallback.
- **Impact:** Long LLM/Hermes calls and streaming chats fail unpredictably; the app's own timeout handling and mock-AI fallback never run; latency budget is implicit/plan-dependent rather than declared.
- **Likelihood:** Medium-High whenever upstream latency exceeds the platform default (common for LLM completions).
- **Reproduction:** Deploy to Vercel default plan; issue a chat that takes >15 s upstream; observe platform 504 before the app's 30 s abort or mock fallback.
- **Evidence:** see Evidence base "No `maxDuration`/`functions` config" and "Upstream timeout" rows.
- **Recommended fix:** Set `export const maxDuration` per route (≥ the 30 s abort, within plan limits) or lower `UPSTREAM_TIMEOUT_MS` to fit the platform budget; declare a `functions` block in `vercel.json`. Make the app timeout strictly < platform `maxDuration` so app-level fallback always wins.
- **Tests to add:** integration test asserting a slow-upstream chat returns the app's structured fallback, not a platform 504.
- **Status:** OPEN — **Owner:** Tony — **Residual risk:** Medium.

## [MEDIUM] No caching on any read path; full-document re-download per load
- **Area:** Caching / latency
- **Affected:** `src/lib/supabase/workspace.ts` (`loadRemoteState`); `src/app/api/health/route.ts:12`; absence of `Cache-Control`/ISR on data routes
- **Description:** There is no read cache anywhere. Each page mount calls `loadRemoteState` which `select`s the full workspace JSONB; the health probe is `force-dynamic` + `no-store`; API responses carry no cache headers; there is no ISR/edge cache or in-memory memoization. Every tab/load is a full round-trip plus full-document transfer.
- **Impact:** Higher TTFB/INP and Supabase egress at scale; redundant transfers for read-heavy navigation; no protection from repeated identical loads.
- **Likelihood:** Medium (cost scales with users × loads × document size).
- **Reproduction:** Load several routes in sequence; observe a full `workspace_state` fetch per mount (network panel) with no caching.
- **Evidence:** see Evidence base "Read path uncached".
- **Recommended fix:** Cache/memoize workspace reads (client query cache + short edge cache where safe); paginate large collections; add explicit `Cache-Control` to safe GET responses. (Couples with the normalization fix above.)
- **Tests to add:** assert repeated identical reads hit cache; measure transfer per navigation.
- **Status:** OPEN — **Owner:** Tony — **Residual risk:** Medium.

## [MEDIUM] DB query performance, indexing, and connection-pool/pooler capacity unverified
- **Area:** Database performance / connection pooling — **UNKNOWN, blocked on access**
- **Affected:** Supabase (PostgREST + Postgres); `src/lib/supabase/server.ts` (per-request clients); `claim_and_record`, `ensure_workspace`, `current_workspace_id`, `current_profile_role` RPCs
- **Description:** The app talks to Postgres only through PostgREST/RPC over HTTPS (no app-managed PG pool), so pooling is delegated to Supabase's PgBouncer/pooler — whose mode (transaction vs session), pool size, and the project compute tier are **not in the repo and not accessible** for this audit. Query plans, index coverage for the RPCs (notably `claim_and_record`, which runs on the hot send path), and PostgREST request limits are unverified. A fresh service-role/server client is created per invocation (extra TLS/handshake per cold call).
- **Impact:** Under concurrency the pooler can saturate (connection waits, 503/timeout from PostgREST); unindexed RPC predicates can degrade the send path; per-request client creation adds overhead on cold starts. None of this is measurable without the deployed project.
- **Likelihood:** Unknown (no access).
- **Reproduction:** Requires the live Supabase project: `EXPLAIN (ANALYZE, BUFFERS)` on the RPC SQL; pooler metrics under the load profile in `CAPACITY_PLAN.md`.
- **Evidence:** per-request clients in `server.ts`; no pooler/compute config in repo (grep).
- **Recommended fix:** Document the pooler mode + pool size + compute tier; verify indexes for `claim_and_record` and workspace lookups via `EXPLAIN ANALYZE`; load-test the send path against the pooler; consider a singleton service client where the runtime permits.
- **Tests to add:** index-coverage assertions; pooler-saturation load test (see `CAPACITY_PLAN.md`).
- **Status:** UNKNOWN — blocked on access to the deployed Supabase project + authorized load test — **Owner:** Tony — **Residual risk:** Unknown → treat as High until measured.

## [MEDIUM] No load profile, SLOs, or load/stress/soak testing (gate driver)
- **Area:** Performance verification — **UNKNOWN, blocked on access**
- **Affected:** whole system
- **Description:** No documented expected load profile (concurrent recruiters, requests/min, candidates/workspace, sends/day), no latency/throughput/error SLOs, and no load/stress/soak test exists. Performance is asserted from demo data only.
- **Impact:** The system's behavior under real concurrency and data volume is entirely unknown; no basis to size infra or set alerts.
- **Likelihood:** N/A (gap).
- **Reproduction:** N/A.
- **Evidence:** no SLO doc, no load tooling, no CI perf step (Evidence base).
- **Recommended fix:** Adopt the load profile, SLOs, and k6 load/stress/soak plan in `CAPACITY_PLAN.md`; run against a staging instance with production-shaped data; add a perf smoke to CI.
- **Tests to add:** k6 baseline/stress/soak scenarios (see `CAPACITY_PLAN.md`).
- **Status:** UNKNOWN — blocked on a staging instance + authorized load test — **Owner:** Tony — **Residual risk:** Unknown.

## [LOW] Single deploy region, no edge/multi-region strategy
- **Area:** Latency / availability topology
- **Affected:** `vercel.json` `"regions": ["cdg1"]`
- **Description:** Functions are pinned to a single region (cdg1/Paris). Acceptable for an EU-centric tool, but there is no documented latency budget for non-EU users and no multi-region failover (also a reliability item).
- **Impact:** Higher latency for distant users; region outage = full outage (see `RELIABILITY_REPORT.md`).
- **Likelihood:** Low (acceptable if user base is EU).
- **Evidence:** `vercel.json`.
- **Recommended fix:** Confirm the user-base geography matches cdg1; document the latency budget; decide multi-region only if the SLA requires it.
- **Status:** ACCEPTED (if EU-only) / OPEN otherwise — **Owner:** Tony — **Residual risk:** Low.

---

## What is verifiably good (performance)

- Upstream Hermes and cloud-LLM calls are **time-bounded** (`AbortSignal.timeout(30_000)`) rather than
  unbounded — a real reliability primitive (the *budget value* is the problem, see the MEDIUM above,
  not its absence).
- The proxy enforces a **1 MB request-body cap** (413) and all JSON APIs cap body size via
  `validateBody({ maxBytes })`, bounding parse cost and a class of memory-pressure abuse.
- Persisted writes are **debounced (600 ms)** in live mode, collapsing bursts into fewer upserts.
- The heavy 3D floor is code-split and excluded from First Load JS (per `FRONTEND_PERFORMANCE_REPORT.md`).

These do not lift the gate, but they should be preserved through any refactor.

---

## Verdict

**Gate 10 (performance half): FAIL + UNKNOWN.** Open HIGH (unbounded full-state persistence;
unpatched Next.js DoS advisory) and MEDIUM (timeout misconfig; no read caching; unverified DB
perf/pooling; no SLOs/load tests) defects, plus entirely unmeasured load behavior. Not releasable
until the storage model is bounded/normalized, the Next.js advisory is addressed, function timeouts
are reconciled with the platform budget, and the `CAPACITY_PLAN.md` load/stress/soak plan is executed
against a staging instance with production-shaped data.
