# Flaky Test Register — MSourcing ("hermes-sourcing")

> SUPERSEDED by `STATUS.md` 2026-07-10 for current release posture. Historical 2026-06-27 evidence may contain stale stack versions, suite counts, migration ranges, and verdicts.


- **Gate:** Gate 9 — QA
- **Date:** 2026-06-27
- **Definition:** a test whose pass/fail can change across runs without a code change (timing, randomness, ordering, environment, network, clock).
- **Method:** scanned all 22 suites for non-deterministic signals — `Math.random`, `Date.now`/`new Date()`, `setTimeout`/`setInterval`, `fetch`/network, sleeps, `process.env`, wall-clock thresholds, and filesystem/path assumptions (`grep -nE "Math\.random|Date\.now|new Date|setTimeout|fetch\(|process\.env" tests/*.mts`).
- **Observed stability this run:** full suite ran **green once** (705/705). No repeated-run loop was executed (each suite would need its own IPC pipe under the sandbox). Entries below are **risk-rated by static signal**, not by observed intermittency, except where noted.

---

## Register

### FLK-01 — `security-redos.mts:21` wall-clock budget assertion — **MEDIUM risk**
- **Signal:** `const t0 = Date.now(); parseEmailAndJD(...); elapsed = Date.now() - t0;` then `ok("... must be < 1000ms", elapsed < 1000)`.
- **Why flaky:** absolute wall-clock threshold. On a busy/slow CI runner, a cold V8 JIT, GC pause, or constrained container, a ~300 KB hostile-input parse can exceed 1000 ms even with no catastrophic backtracking — producing a spurious FAIL. The ReDoS *protection* is real; the *timing assertion* is the fragile part.
- **Observed:** passed this run (margin not printed, but assertion held).
- **Severity if it fires:** blocks CI / `npm run test` (sets `process.exitCode=1`), looks like a security regression when it is just slowness.
- **Mitigation:** raise threshold to ~3000 ms, **or** assert relative scaling (e.g. time for 2× input < ~3× time for 1× input) instead of an absolute ms budget; optionally run a warm-up pass first.
- **Status:** OPEN — watch.

### FLK-02 — `memory-soul.mts:26` `Math.random()` id generation — **LOW risk**
- **Signal:** `return \`${prefix}_test_${Math.random().toString(36).slice(2,8)}\`;`
- **Why low:** randomness is used only to mint unique ids for fixtures; assertions check structure/behavior, not specific id values. Collision within a run is astronomically unlikely (6 base-36 chars). Not order-dependent.
- **Severity if it fires:** practically nil.
- **Mitigation:** optional — replace with a deterministic counter for fully reproducible fixtures.
- **Status:** ACCEPTED.

### FLK-03 — `Date`/clock usage in `chat.mts`, `memory-soul.mts`, `rules-confidential.mts` — **LOW risk**
- **Signal:** multiple `new Date().toISOString()` calls to stamp fixtures (`chat.mts:63,68,78,98,103`; `memory-soul.mts:35,56,69,140`; `rules-confidential.mts:68,89`).
- **Why low:** timestamps are stored on fixtures, not asserted for equality against a fixed value or compared across a clock-tick boundary. No `Date` mocking, but no time-sensitive assertion either.
- **Risk edge:** a future assertion comparing two timestamps generated in the same millisecond (e.g. `createdAt !== updatedAt` ordering) would become flaky. None present today.
- **Mitigation:** inject a fixed clock if any time-ordering assertion is added later.
- **Status:** ACCEPTED (watch if time-ordering assertions are introduced).

### FLK-04 — sequential `&&` suite chain hides downstream failures — **LOW risk (suite-design)**
- **Signal:** `package.json scripts.test` chains 22 suites with `&&`; the run aborts at the first non-zero exit.
- **Why it matters for flakiness triage:** if an early suite flakes (e.g. FLK-01), suites 6–22 never run, so a single flaky timing test masks the status of everything after it and skews "which test failed" triage.
- **Mitigation:** run suites independently (a small runner that executes all and aggregates), or move to a real runner (vitest) so one flake doesn't blank the rest of the report.
- **Status:** OPEN — process improvement.

### FLK-05 — environment-dependent runnability under sandbox (`tsx` IPC) — **environmental, not product**
- **Signal:** `tsx` binds a unix-socket IPC pipe at startup; the default command sandbox denies `listen` → `Error: listen EPERM … /tmp/claude-501/tsx-501/<pid>.pipe`.
- **Why it matters:** any runner inside the sandbox will see a 100% "failure" that is actually a permission denial, not a test result — a classic false-flaky. Bypassing the sandbox (or running on Linux CI) makes it deterministic green.
- **Mitigation:** document in `LOCAL_SETUP.md`; CI on Linux is unaffected.
- **Status:** ACCEPTED (documented).

---

## Non-flaky confirmation

No suite uses `fetch`, real network, `setTimeout`/`setInterval`-driven async, randomized iteration order over a Set/Map that is later asserted positionally, or external services. `hermes-live.mts` and `ai-provider.mts` exercise the **mock/deterministic** branch (no network). `security-audit.mts` reads the local `./src` tree (deterministic given the tree). The dominant non-determinism is the single timing assertion FLK-01.

---

## Summary

| ID | Test | Risk | Status |
|---|---|---|---|
| FLK-01 | `security-redos.mts` `<1000ms` | MEDIUM | OPEN (watch) |
| FLK-02 | `memory-soul.mts` `Math.random` ids | LOW | ACCEPTED |
| FLK-03 | `Date`-stamped fixtures (3 suites) | LOW | ACCEPTED |
| FLK-04 | `&&` chain masks downstream | LOW | OPEN (process) |
| FLK-05 | sandbox `tsx` IPC EPERM | env | ACCEPTED (documented) |

**Net:** suite is largely deterministic. One timing assertion (FLK-01) is the only material flake risk; address it before relying on the suite as a hard CI gate.
