# CAPACITY PLAN & LOAD-TEST PLAN — MSourcing (Aria / "hermes-sourcing")

> SUPERSEDED by `STATUS.md` 2026-07-10 for current release posture. Historical 2026-06-27 evidence may contain stale stack versions, suite counts, migration ranges, and verdicts.


**Phase 10 deliverable — Performance / Reliability Engineer.** Audit date: 2026-06-27. **New document.**
Maps to **Release Gate 10 — Performance / reliability**. Companion to `PERFORMANCE_REPORT.md` and
`RELIABILITY_REPORT.md`.

This document supplies what the repo lacks: a **proposed** expected load profile, **proposed**
latency/throughput/error SLOs, a capacity model derived from the code's architecture, and the
**load/stress/soak/dependency-failure test plan** required to move Gate 10 out of UNKNOWN. The
numeric profile and SLOs below are **proposals for human ratification, not measured facts** — no
load test has been run (no live/staging access authorized; no load tooling in repo).

> **Status of measured capacity: UNKNOWN — blocked on a staging instance with production-shaped data
> and an authorized load harness.** Everything in §4–§6 is a plan to *obtain* the numbers, not the
> numbers themselves.

---

## 1. Why there is no measured capacity today

- No load profile, SLO doc, or performance budget exists in the repo (grep; `scripts/` holds only
  `backup.sh`, `restore-drill.sh`, `local-supabase-up.sh`).
- No load tooling (`k6`/`artillery`/`autocannon`/`lighthouse`) in `package.json` or `tests/`.
- No perf step in CI (`.github/workflows/ci.yml`).
- The deployed Supabase project, its compute tier, and its pooler configuration are **not in the repo
  and not accessible** for this audit (see `PERFORMANCE_REPORT.md` DB finding).

Per the operating rules, capacity is therefore **UNKNOWN**, not PASS.

---

## 2. Proposed expected load profile (RATIFY BEFORE USE)

A recruiting-operations console for an internal/B2B audience. Proposed reference profile for an early
production rollout — **replace with real business numbers before load-testing**:

| Dimension | Proposed value (placeholder) | Notes |
|---|---|---|
| Workspaces (tenants) | 1–20 | one per org/email-domain (`ensure_workspace`) |
| Concurrent recruiters (peak) | 5–20 per workspace; ~50 global | drives concurrent writers (see consistency risk) |
| Active candidates per workspace | 1k–10k (target), 50k (stretch) | unbounded in current JSONB model — the ceiling driver |
| Ledger rows per workspace | 5k–50k+ | unbounded; append-only on every contact |
| Page loads / recruiter / hour | 20–60 | each currently re-downloads the full workspace doc |
| Outreach sends / workspace / day | 100–2 000 | bounded by per-seat caps; each = 1 send-path invocation |
| Chat / LLM requests / min (peak) | 5–30 | each is a long (up to 30 s) upstream call |
| Intake POSTs / hour | 10–100 | inbound JD-email parsing |

**Burstiness:** recruiter activity is workday-shaped (EU hours, matching `cdg1`), with bursts around
campaign launches and reply waves. The **debounced full-state save** turns a burst of UI edits into
repeated large upserts of an ever-growing document — model this explicitly in §4.

---

## 3. Proposed SLOs (RATIFY BEFORE USE)

Targets to validate against, once measurable. **Proposed, not yet met.**

| Metric | Proposed SLO | Measured? |
|---|---|---|
| API read p95 (page data load) | < 500 ms at target data volume | UNKNOWN |
| API write p95 (state save) | < 800 ms at target data volume | UNKNOWN |
| Outreach send p95 (excl. provider) | < 1.5 s | UNKNOWN |
| Chat/LLM p95 (incl. upstream) | < 10 s (must fit platform `maxDuration`) | UNKNOWN |
| Error rate (5xx + platform 504) | < 0.5% at peak | UNKNOWN |
| Availability | 99.5% (single-region acceptance) / 99.9% (needs multi-region) | UNKNOWN |
| Data durability (no silent loss) | 0 lost writes | **FAILING by design** (last-write-wins + silent save errors — see `RELIABILITY_REPORT.md`) |

**Error budget:** at 99.5% availability ≈ 3.6 h/month. Single-region (`cdg1`) + no failover means one
region/Supabase incident can exhaust the monthly budget in a single event.

---

## 4. Capacity model (derived from code, not measured)

The dominant capacity driver is the **single-JSONB-document persistence model** (see
`PERFORMANCE_REPORT.md` HIGH finding):

- **Save cost ≈ O(total workspace state size)** per debounced write. As candidates/ledger/outreach
  grow unbounded, each 600 ms save re-serializes + uploads the *whole* document. Estimate the blob as
  `~Σ(rows × avg-row-JSON-bytes)`; at 10k candidates + 50k ledger rows this is plausibly multi-MB per
  save and per load.
- **Load cost ≈ O(total state size)** per page mount (`loadRemoteState` selects the full `state`).
  Read-heavy navigation multiplies this by page loads/hour with no cache.
- **Concurrency ceiling:** last-write-wins means *effective* safe concurrency per workspace is ~1
  active writer; beyond that, data loss (not just slowdown). This caps real multi-recruiter use today.
- **Serverless concurrency:** each outbound email/OAuth/DNS call has **no timeout**, so a slow
  provider pins function instances up to the platform limit — concurrency is bounded by
  `(platform timeout) × (provider latency)` during any provider degradation.
- **DB pooling:** all DB access is via PostgREST/RPC over HTTPS; the pooler mode/size and compute tier
  are UNKNOWN — the send path's `claim_and_record` is the hot RPC to size.

**Implication:** the architecture scales fine at demo volume but has a hard ceiling at production data
volume + multi-recruiter concurrency. The capacity fix is structural (normalize entities, paginate,
cache, add concurrency control), not just bigger compute — see the two companion reports.

---

## 5. Load / stress / soak / resilience test plan (REQUIRED to clear UNKNOWN)

Run against a **staging** instance seeded with **production-shaped data** (use the §2 stretch volumes).
Tooling proposal: **k6** for HTTP load (scriptable, CI-friendly); add `EXPLAIN (ANALYZE, BUFFERS)`
for DB plans and Supabase pooler metrics for the DB dimension.

### 5.1 Baseline (find the knee)
- Ramp virtual users 1 → target concurrent recruiters over 10 min on a realistic mix (page-data
  reads, state saves, a few sends, occasional chat).
- Record p50/p95/p99 latency + error rate per endpoint; identify the knee.
- **Pass:** SLOs in §3 met at the §2 peak.

### 5.2 Stress (find the ceiling)
- Ramp past target until error rate > 1% or p95 breaches 2× SLO.
- Record the breaking load and the first component to fail (function timeout? pooler? JSONB write?).
- **Pass:** breaking point ≥ 2× the §2 peak with graceful degradation (no data corruption).

### 5.3 Data-volume scaling (the primary ceiling)
- Seed 1×, 10×, 100× demo data; measure `saveRemoteState` payload size + upsert latency and
  `loadRemoteState` transfer + parse time at each.
- **Pass:** save/load stay within §3 SLOs at the 10× (target) volume; document the 100× behavior.

### 5.4 Soak (leaks / drift)
- Hold ~70% of the §2 peak for ≥ 2 h.
- Watch for memory growth, rising latency, pooler exhaustion, and **ledger drift** (stuck `claimed`
  rows from `RELIABILITY_REPORT.md`).
- **Pass:** flat latency/memory; zero stuck `claimed` rows; zero silent save losses.

### 5.5 Concurrency / consistency
- Two+ writers in one workspace editing different entities concurrently.
- **Pass:** no silent overwrite (currently **expected to FAIL** — last-write-wins).

### 5.6 Dependency-failure (resilience) — maps to `RELIABILITY_REPORT.md` matrix
| Scenario | Inject | Expected (after fixes) |
|---|---|---|
| Supabase read down | block PostgREST reads | app degrades to in-memory, clear UI state |
| Supabase write down | block upserts | **visible** save-failed state + retry (today: silent loss) |
| Hermes runtime down | stop upstream | chat falls back to mock; clear messaging for agent features |
| Cloud LLM 5xx/timeout | fault-inject | bounded timeout + (post-fix) retry/breaker, then fallback |
| Email provider hang | sinkhole | **fast timeout** + ledger reconciled `skipped`/retryable (today: hang) |
| OAuth endpoint hang | sinkhole | fast timeout + clear error (today: hang) |
| DNS hang | sinkhole | fast timeout + fail-safe unverified (today: hang) |
| Mid-send crash | kill function post-claim | TTL/reaper or idempotency recovery (today: stuck `claimed`) |
| Redeploy under load | deploy mid-test | requests drain, no errors |

### 5.7 Function-timeout reconciliation
- Confirm platform `maxDuration` vs the in-code 30 s `AbortSignal` (see `PERFORMANCE_REPORT.md`
  MEDIUM); assert slow-upstream chats return the app fallback, not a platform 504.

---

## 6. Recommended monitoring to size & defend capacity (currently absent — Gate 11 FAIL)

No APM/RUM/metrics exist (`RELEASE_GATE_MATRIX.md` Gate 11 = FAIL). To run and sustain the above:
- **RUM/CWV** (LCP/INP/CLS) per route (ties to `FRONTEND_PERFORMANCE_REPORT.md`).
- **Function metrics**: invocation duration, timeout/504 rate, concurrency, cold starts.
- **DB metrics**: PostgREST request rate/latency/errors; pooler utilization; slow-query log;
  `claim_and_record` latency.
- **Persistence metrics**: `saveRemoteState` payload size + success/fail rate; stuck-`claimed` count.
- **Upstream metrics**: per-provider (Hermes/LLM/email/OAuth) latency, timeout, error rate.
- **Alerts**: error-budget burn, p95 breach, save-failure spike, stuck-claim count, pooler saturation.

---

## 7. Verdict

**Capacity: UNKNOWN — blocked on a staging instance with production-shaped data + an authorized load
harness.** Required to clear UNKNOWN: (1) business ratification of the §2 load profile and §3 SLOs;
(2) execution of the §5 load/stress/data-volume/soak/dependency-failure tests against staging; (3)
the structural fixes from `PERFORMANCE_REPORT.md` and `RELIABILITY_REPORT.md` (bound/normalize the
state document, add timeouts, add concurrency control) — without which the §5.3/§5.5 tests are
expected to fail at production scale. Until then, capacity at production volume and multi-recruiter
concurrency cannot be claimed.
