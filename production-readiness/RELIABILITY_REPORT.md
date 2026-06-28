# RELIABILITY REPORT — MSourcing (Aria / "hermes-sourcing")

**Phase 10 deliverable — Performance / Reliability Engineer.** Audit date: 2026-06-27. **New document.**
Maps to **Release Gate 10 — Performance / reliability** (reliability half; performance half in
`PERFORMANCE_REPORT.md`; capacity model + load-test plan in `CAPACITY_PLAN.md`).

Scope (this file): timeouts, retries, idempotency, circuit-breakers in the Hermes proxy and the
outreach/email-send path; dependency-failure behavior (Supabase down, Hermes down, email/OAuth
provider down, DNS down); graceful degradation and graceful shutdown; data-durability/consistency of
the persistence layer; single-region/failover posture; resilience test coverage.

**Audit-only.** No application source was modified. Evidence is repo-verified (`file:line`) or from
commands run during this audit. Working tree was **dirty** at audit time (branch `main`).

---

## Executive summary

The codebase shows **partial, uneven reliability engineering**. The Hermes/cloud-LLM proxy is the
mature path: it has upstream timeouts, structured error logging, graceful degradation to a
deterministic mock, and a clean SSRF/allow-list posture. The **outreach send path** is correct on the
*safety* axis (never auto-sends; atomic guardrail claim with de-dupe) but has real **reliability**
gaps. The **persistence layer** is the weakest link: a single shared JSONB document with
**last-write-wins concurrency** and **silently swallowed save errors** — a data-durability and
data-consistency risk for any multi-recruiter workspace.

The defining gaps:

1. **No timeouts on any outbound email or OAuth call.** Resend, SendGrid, Gmail API send, Microsoft
   Graph send, Google/Microsoft token refresh, and the DNS deliverability check all use bare `fetch`
   / `dns.resolveTxt` with **no `AbortSignal`/timeout**. A slow or hung provider stalls the serverless
   function up to the platform limit and, on the send path, holds a guardrail "claimed" slot.
2. **No retries and no circuit-breakers anywhere.** Every upstream is single-attempt; a transient
   blip surfaces as a hard failure with no backoff and no breaker to shed load during an outage.
3. **Concurrent writes lose data (last-write-wins).** `saveRemoteState` upserts the whole workspace
   document keyed only by `workspace_id`, with **no optimistic-concurrency check** (no version/ETag,
   no `updated_at` compare). Two recruiters editing the same workspace silently overwrite each other.
4. **Save failures are silent.** `saveRemoteState` catches errors and only `console.warn`s — no user
   feedback, no retry, no queue. With the 600 ms debounce, a tab closed inside the window loses the
   last edits with no signal.
5. **A "claimed" ledger row can get stuck.** If the function dies between `claim_and_record` and the
   reconcile update, the row stays `claimed` forever — the candidate becomes permanently
   un-recontactable yet is never recorded as sent, and there is no TTL/reaper to recover the slot.
6. **No resilience/failover testing.** No chaos/dependency-down tests; single deploy region; the
   separate always-on Hermes Python runtime (not in this repo) has no documented HA/restart story.

Graceful degradation when a dependency is *down but slow-failing fast* is genuinely good (Hermes →
mock; Supabase load failure → in-memory; demo mode → never sends). The problem is the **hang-without-
timeout** and **silent-write-loss** classes, plus the absence of retries/breakers and any resilience
testing. Per the operating rules (untested = FAIL/UNKNOWN), the reliability half of Gate 10 fails.

### Gate 10 (reliability half): **FAIL**
- Verified-good: Hermes/cloud-LLM timeouts + graceful mock fallback; outreach atomic de-dupe claim;
  never-auto-send invariant; demo mode has no send backend.
- Open defects (HIGH): no timeouts on email/OAuth/DNS calls; last-write-wins workspace persistence
  (data loss on concurrency).
- Open defects (MEDIUM): no retries/circuit-breakers; silent save-error swallowing; stuck "claimed"
  ledger rows (no idempotency-recovery/reaper); single region / no failover.
- Unverifiable (UNKNOWN — blocked): dependency-down behavior under load, soak stability, Hermes
  runtime HA, graceful drain on deploy. Test plan in `CAPACITY_PLAN.md`.

---

## Evidence base

| Item | Evidence |
|---|---|
| Hermes proxy timeout | `src/lib/api/hermes-proxy.ts:11` `HERMES_PROXY_TIMEOUT_MS = 30_000`; applied in `hermes/proxy/route.ts` |
| Chat/cloud-LLM timeout | `src/app/api/hermes/chat/route.ts` `UPSTREAM_TIMEOUT_MS = 30_000` on both branches |
| Graceful mock fallback | `hermes/chat/route.ts` returns `{ ok:false, reason }` on upstream error/network error; store falls back to `src/lib/mock-ai.ts` |
| **No timeout: Resend/SendGrid** | `src/lib/providers.ts:85,111` — `fetch(...)` with **no `signal`/`AbortSignal`**; grep for `AbortSignal\|timeout` in `providers.ts` → none |
| **No timeout: Gmail/Graph send** | `src/lib/email-oauth.ts:30,53` — `fetch(...)` with no timeout |
| **No timeout: OAuth token refresh** | `src/lib/email-oauth.ts:108,139` — Google/Microsoft token refresh `fetch(...)` with no timeout |
| **No timeout: DNS check** | `src/lib/domain-verification.ts:29` — `dns.resolveTxt(name)` with no timeout (called from the live send path) |
| No retries / breakers | grep `retry\|backoff\|circuit\|breaker` across `src/` → none |
| Last-write-wins persistence | `src/lib/supabase/workspace.ts` `saveRemoteState` upsert `onConflict: "workspace_id"`, no version/`updated_at` precondition |
| Silent save-error swallow | `workspace.ts` — `if (error) console.warn("saveRemoteState failed:", ...)`; `catch (err) { console.warn(...) }`; no rethrow/retry/UI |
| Debounced persist | `src/lib/store.ts:408-413` — 600 ms `setTimeout`; risk of loss if unmounted within window |
| Atomic outreach claim (good) | `src/app/api/outreach/send/route.ts:104` `supabase.rpc("claim_and_record", ...)` — suppression + window + cap + de-dupe |
| Reconcile pattern / stuck-claim risk | `outreach/send/route.ts:108-117` — claim recorded `claimed`, reconciled to `sent`/`skipped` after provider responds; no recovery if process dies between claim and reconcile |
| Supabase load failure → in-memory | `workspace.ts` `loadRemoteState` catches errors → returns `{ workspaceId:"", state:null }`; app runs in-memory |
| Never auto-send / demo safe | `outreach/send/route.ts:50-55` — demo or `!confirmLive` ⇒ dry-run, nothing sent |
| Single region / no failover | `vercel.json` `"regions": ["cdg1"]` |
| No graceful-shutdown handling | no `SIGTERM`/`process.on` handlers in repo (grep); serverless model delegates to platform; self-host `next start` relies on Next defaults; Hermes Python runtime not in repo |
| No resilience tests | `tests/` has `hermes-proxy.mts`, `hermes-live.mts` (contract/behavior) but no dependency-down/chaos/failover/soak suites |
| Next.js DoS advisory | `npm audit --omit=dev` → HIGH DoS advisories (availability) — see `PERFORMANCE_REPORT.md` |

---

## Findings

## [HIGH] No timeout on any outbound email, OAuth-refresh, or DNS call
- **Area:** Reliability — timeouts / dependency-failure handling
- **Affected:** `src/lib/providers.ts:85` (Resend), `:111` (SendGrid); `src/lib/email-oauth.ts:30` (Gmail send), `:53` (Graph send), `:108` (Google refresh), `:139` (Microsoft refresh); `src/lib/domain-verification.ts:29` (`dns.resolveTxt`)
- **Description:** Every outbound call on the send path uses a bare `fetch` (or `dns.resolveTxt`) with **no `AbortSignal`/timeout**. By contrast the Hermes/cloud-LLM proxy correctly bounds its calls at 30 s. If Resend/SendGrid/Gmail/Graph/the OAuth token endpoint/DNS is slow or hangs, the request stalls until the platform function timeout kills it — and on the send path the guardrail slot is already `claimed`, so the candidate is locked while the function hangs.
- **Impact:** A single degraded third party can exhaust serverless concurrency (queueing/cold-start storms), drive p99 latency to the platform ceiling, and strand de-dupe slots — converting a partner slowdown into an MSourcing outage and contact-pipeline stall.
- **Likelihood:** Medium-High (third-party email/OAuth latency spikes are routine).
- **Reproduction:** Point a provider call at a sink that accepts the connection but never responds; observe the function hang to the platform limit instead of failing fast.
- **Evidence:** Evidence base rows "No timeout: …".
- **Recommended fix:** Wrap every outbound call in `AbortSignal.timeout(<budget>)` (e.g. 8–10 s for email/OAuth, 2–3 s for DNS), strictly below the platform `maxDuration`; on timeout, reconcile the ledger slot to `skipped` so it stays retryable.
- **Tests to add:** unit/integration tests asserting each send/refresh/DNS path aborts within budget and reconciles the ledger on timeout.
- **Status:** OPEN — **Owner:** Tony — **Residual risk:** High until timeouts are added.

## [HIGH] Workspace persistence is last-write-wins — concurrent recruiters silently overwrite each other
- **Area:** Reliability — data consistency / durability
- **Affected:** `src/lib/supabase/workspace.ts` (`saveRemoteState`); `src/lib/store.ts:400-413` (debounced persist of full snapshot)
- **Description:** The whole workspace is one JSONB row; `saveRemoteState` upserts it keyed only on `workspace_id`, with **no optimistic-concurrency control** — no version column, no `updated_at` precondition, no merge. Two users (or two tabs) in the same workspace each persist their own full snapshot; the later 600 ms-debounced write clobbers the earlier one wholesale. Because the document is read-once on mount and not re-synced, each client also works from a stale base, widening the lost-update window.
- **Impact:** Silent loss of candidate edits, outreach drafts, approvals, ledger entries, and settings whenever two people use the same workspace concurrently — exactly the multi-recruiter scenario the product targets. No error is shown.
- **Likelihood:** High in any real multi-user workspace.
- **Reproduction:** Open the same workspace in two sessions; edit different campaigns in each; observe the second save overwrite the first's changes after the debounce.
- **Evidence:** Evidence base "Last-write-wins persistence", "Debounced persist".
- **Recommended fix:** Add optimistic concurrency (version/`updated_at` precondition; reject + reload-and-merge on conflict) — or, preferably, normalize entities into per-row tables so concurrent edits touch different rows (couples with the `PERFORMANCE_REPORT.md` storage fix). Add realtime sync or conflict surfacing.
- **Tests to add:** concurrent-write test asserting no silent overwrite; conflict-resolution test.
- **Status:** OPEN — **Owner:** Tony — **Residual risk:** High until concurrency control exists. (Cross-ref `DATABASE_REVIEW.md`.)

## [MEDIUM] No retries, backoff, or circuit-breakers on any upstream
- **Area:** Reliability — fault tolerance
- **Affected:** Hermes proxy/chat, all email/OAuth providers, Supabase calls (`src/`)
- **Description:** Every upstream interaction is single-attempt. There is no retry-with-backoff for transient 5xx/429/network blips and no circuit-breaker to fail fast and shed load during a sustained outage. The mock fallback (Hermes only) helps, but a one-off transient error still surfaces as a user-visible failure, and during a provider outage every request pays full timeout before failing.
- **Impact:** Elevated error rate during transient incidents; during a sustained dependency outage, no breaker means sustained slow-failures and resource pile-up.
- **Likelihood:** Medium.
- **Reproduction:** Inject intermittent 503s at a provider; observe single-attempt failures with no retry and no breaker opening.
- **Evidence:** grep for `retry|backoff|circuit|breaker` → none.
- **Recommended fix:** Add bounded retry-with-jittered-backoff for idempotent reads and clearly-transient errors (NOT for email sends without an idempotency key — see next finding); add a simple per-dependency circuit-breaker that opens on consecutive failures and short-circuits to the fallback.
- **Tests to add:** retry-on-transient test; breaker-opens-after-N-failures test.
- **Status:** OPEN — **Owner:** Tony — **Residual risk:** Medium.

## [MEDIUM] Stuck "claimed" ledger rows — no idempotency-recovery / reaper for partial sends
- **Area:** Reliability — idempotency / self-healing
- **Affected:** `src/app/api/outreach/send/route.ts:104-117` (claim → send → reconcile)
- **Description:** The send path is correctly *fail-safe against double-send*: `claim_and_record` records a `claimed` slot before the provider call, and a retry is blocked while the slot is held — so a crash never double-contacts. But if the function dies (platform timeout/crash) **after** the claim and **before** the reconcile update, the row stays `claimed` indefinitely. There is no TTL, no reaper, and no client-supplied idempotency key to safely resume, so the candidate is permanently locked out of re-contact yet never recorded as `sent`.
- **Impact:** Candidates silently dropped from the pipeline after partial failures; manual DB cleanup required; the de-dupe ledger drifts from reality over time.
- **Likelihood:** Medium (any function timeout/crash mid-send, made more likely by the missing email timeouts above).
- **Reproduction:** Kill the function between `claim_and_record` and the reconcile update; observe the `claimed` row never transitions.
- **Evidence:** `outreach/send/route.ts:108-117`.
- **Recommended fix:** Add a TTL/reaper that reverts stale `claimed` rows to retryable after a grace period, and/or a client idempotency key so a resumed request reconciles the existing slot instead of stranding it. Ensure every error path (including timeout) reconciles to `skipped`.
- **Tests to add:** crash-between-claim-and-reconcile test asserting eventual recovery; idempotency-key replay test.
- **Status:** OPEN — **Owner:** Tony — **Residual risk:** Medium.

## [MEDIUM] Save failures are silently swallowed — no user feedback, retry, or durable queue
- **Area:** Reliability — durability / observability
- **Affected:** `src/lib/supabase/workspace.ts` (`saveRemoteState`); `src/lib/store.ts:414-417` (demo `localStorage` write swallows quota errors)
- **Description:** `saveRemoteState` logs failures with `console.warn` only — it does not surface them to the user, retry, or queue. Combined with the 600 ms debounce, an edit made just before a network blip / tab close / quota error is lost with no signal. The demo `localStorage` path likewise swallows quota/private-mode errors.
- **Impact:** Silent data loss; users believe work is saved when it is not; no telemetry to detect a persistence outage.
- **Likelihood:** Medium.
- **Reproduction:** Make `saveRemoteState` fail (offline) after an edit; observe only a console warning and lost data on reload.
- **Evidence:** Evidence base "Silent save-error swallow", "Debounced persist".
- **Recommended fix:** Surface a save-failed state in the UI, retry with backoff, and queue pending writes (e.g. flush on `visibilitychange`/`beforeunload`); emit a metric on save failure.
- **Tests to add:** save-failure test asserting user-visible error + retry; flush-on-unload test.
- **Status:** OPEN — **Owner:** Tony — **Residual risk:** Medium.

## [MEDIUM] No graceful-shutdown / deploy-drain handling; Hermes runtime HA undocumented
- **Area:** Reliability — lifecycle / availability — **partially UNKNOWN**
- **Affected:** whole app; the separate always-on Hermes Python runtime (not in this repo)
- **Description:** On Vercel serverless, request draining on redeploy is platform-managed (acceptable), so there is no in-repo shutdown handler — but this is *delegated, not designed*, and a self-hosted `next start` deployment would rely on Next defaults with no explicit `SIGTERM` handling. Separately, the chat path proxies to an always-on NousResearch `hermes-agent` aiohttp server (`hermes/chat/route.ts` header comment) which is **outside this repo**; its restart/HA/backpressure story is undocumented and unverifiable here.
- **Impact:** In-flight requests may be cut on self-hosted redeploys; a Hermes runtime restart/outage degrades the chat/agent features (mitigated by the mock fallback for chat, but agent runtime features have no fallback).
- **Likelihood:** Low-Medium (Vercel) / Unknown (self-host + Hermes runtime).
- **Reproduction:** Requires deployed infra + access to the Hermes runtime.
- **Evidence:** no signal handlers in repo (grep); `vercel.json` serverless; Hermes runtime external.
- **Recommended fix:** Document the deploy model and confirm Vercel draining; for self-host, add `SIGTERM` draining. Document the Hermes runtime HA/restart/backpressure design and a degraded-mode plan; verify the mock fallback covers the user-facing chat path during a runtime outage.
- **Tests to add:** redeploy-during-load drain test (staging); Hermes-down behavior test.
- **Status:** UNKNOWN (Hermes runtime) / OPEN (self-host drain) — blocked on deployed infra + Hermes runtime access — **Owner:** Tony — **Residual risk:** Medium.

## [MEDIUM] Single region, no failover; no resilience/chaos test coverage
- **Area:** Reliability — availability topology / testing
- **Affected:** `vercel.json` `"regions": ["cdg1"]`; `tests/` (no chaos/dependency-down/failover/soak)
- **Description:** Functions run in one region with no failover; a cdg1/Supabase-region incident is a full outage. There is no automated resilience testing: no dependency-down simulation, no failover drill, no soak. The DR posture is covered separately (`DISASTER_RECOVERY_PLAN.md`, Gate 12 = FAIL) and reinforces this gap.
- **Impact:** Region/provider incident = total unavailability with no tested recovery; reliability behaviors above are unproven under real conditions.
- **Likelihood:** Low frequency, high impact.
- **Reproduction:** N/A (gap).
- **Evidence:** `vercel.json`; absence of resilience suites.
- **Recommended fix:** Decide an availability target; if it requires it, add multi-region + a failover runbook; add the dependency-down/soak scenarios from `CAPACITY_PLAN.md` to CI/staging.
- **Tests to add:** Supabase-down, Hermes-down, email-provider-down, and soak scenarios (see `CAPACITY_PLAN.md`).
- **Status:** OPEN — **Owner:** Tony — **Residual risk:** Medium-High at availability-sensitive scale.

---

## Dependency-failure behavior matrix (as-coded)

| Dependency | Failure handling today | Verdict |
|---|---|---|
| **Hermes runtime down/slow** | 30 s timeout, structured error, **graceful fallback to deterministic mock** for chat | Good for chat; agent-runtime features have no fallback |
| **Cloud LLM (Anthropic/OpenAI/…) down** | 30 s timeout, `{ ok:false, reason }` returned; caller can fall back to mock | Good (but no retry on transient) |
| **Supabase load (read) fails** | caught → in-memory `{ state:null }`; app runs degraded | Acceptable degradation |
| **Supabase save (write) fails** | `console.warn` only — **silent data loss**, no retry/UI | **Defect (MEDIUM)** |
| **Email provider (Resend/SendGrid/Gmail/Graph) down/slow** | **no timeout** → hang to platform limit; on error, ledger reconciled to `skipped` (retryable) | **Defect (HIGH)** — hang; reconcile is good |
| **OAuth token endpoint down/slow** | **no timeout** → hang; refresh-fail → `error` outcome | **Defect (HIGH)** — hang |
| **DNS down/slow** (deliverability check) | **no timeout** → hang; `resolveTxt` failure → treated as unverified (fail-safe) | **Defect (HIGH)** — hang; result is fail-safe |
| **Concurrent writers** | last-write-wins, no merge | **Defect (HIGH)** — data loss |
| **Mid-send crash** | de-dupe holds (no double-send) but slot stuck `claimed` | **Defect (MEDIUM)** — no recovery |

---

## What is verifiably good (reliability)

- **Time-bounded Hermes/cloud-LLM calls** with **graceful degradation to a deterministic mock** — a
  real, tested fallback for the AI path.
- **Atomic, fail-safe outreach claim** (`claim_and_record`): suppression + re-contact window +
  per-seat cap + de-dupe in one Postgres RPC; a crash never double-contacts.
- **Never-auto-send invariant**: a real send requires live mode + verified domain + explicit
  `confirmLive`; demo mode has no send backend at all → always dry-run.
- **Supabase read failure degrades to in-memory** rather than crashing.
- **Reconcile-after-send** frees the de-dupe slot on provider failure so failed sends stay retryable.

Preserve these through any reliability refactor.

---

## Verdict

**Gate 10 (reliability half): FAIL.** Open HIGH defects (no timeouts on email/OAuth/DNS calls;
last-write-wins persistence causing silent multi-user data loss) and MEDIUM defects (no
retries/breakers; silent save-error swallowing; stuck `claimed` ledger rows; single region; no
resilience tests), with dependency-down-under-load and Hermes-runtime HA unverifiable here. Not
releasable until outbound calls are time-bounded, persistence gains concurrency control + visible
save failures, the send path becomes recoverable (TTL/reaper or idempotency key), and the
dependency-down/soak scenarios in `CAPACITY_PLAN.md` are executed against staging.
