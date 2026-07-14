# RED TEAM / ADVERSARIAL REVIEW — Gate 14

> SUPERSEDED by `STATUS.md` 2026-07-10 for current release posture. Historical 2026-06-27 evidence may contain stale stack versions, suite counts, migration ranges, and verdicts.


**Target:** MSourcing ("hermes-sourcing") — autonomous recruiting operations console
**Repo:** `/Users/tony/Library/CloudStorage/OneDrive-MantuGroup/Documents/TEST/MSourcing`
**Branch:** `main` — **WORKING TREE DIRTY** (60+ modified files; migrations `0004`/`0005` untracked; no git remote, no upstream)
**Reviewer role:** Red Team / Adversarial Reviewer — challenge the PASS decisions
**Date:** 2026-06-27
**Gate 14 verdict:** **FAIL** — multiple optimistic sub-gate PASSes do not survive challenge, and a CRITICAL cross-cutting auth-bypass deploy path is owned by no single gate.

---

## 0. Method

Every reviewer overall-gate verdict is already FAIL or UNKNOWN — **no overall gate is PASS**, so there is no over-optimistic *headline*. The risk lives in the **sub-gate PASSes** that prop up partial confidence and that a reader will quote out of context ("tenant isolation: PASS", "SSRF allow-list: PASS", "admin-only routes: PASS"). For each, I asked: *what evidence would disprove this?* and went and got it from the current tree. Where the disproving evidence exists, I recommend a status override. I also surface two cross-cutting risks no single reviewer owned.

Evidence is file:line against the **dirty working tree** as instructed.

---

## CRITICAL

## [CRITICAL] OVERRIDE (cross-cutting): Fail-open demo mode is shippable to production with no hard guard — an auth-bypass deploy path
- **Area / Affected:** `src/lib/supabase/config.ts:13`, `src/lib/supabase/server.ts:21-23`, `src/app/api/hermes/proxy/route.ts:38`, `src/app/api/intake/route.ts:57`, `src/middleware.ts`, `src/app/api/health/route.ts:17,20`
- **Which gate(s) this defeats:** Gate 4 Authorization "Admin-only mutating routes" (PASS), Gate 4 API "Per-endpoint authorization (RBAC)" (PASS), Gate 4 Backend "Auth enforced on protected routes" (PASS), Gate 4 API "Hermes proxy SSRF allow-list" (PASS) — all are wrapped in `if (supabaseEnabled)`.
- **Optimistic claim being challenged:** Each Phase-4 reviewer awards a PASS for in-handler auth/RBAC/admin-gating. Those PASSes are silently conditional on `supabaseEnabled === true`.
- **Counter-argument (the disproof):** `supabaseEnabled` is *only* `SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0` (config.ts:13). `requireAdmin()` returns `{ ok: true, role: "admin" }` whenever `!supabaseEnabled` (server.ts:21-23). The proxy wraps its entire auth+admin block in `if (supabaseEnabled)` (proxy/route.ts:38). Intake gates auth the same way (intake/route.ts:57). **A production deploy that omits, typos, or fails to inject the two `NEXT_PUBLIC_SUPABASE_*` env vars boots with zero authentication and treats every anonymous internet caller as admin** — full read/write to the workspace, the Aria config/memory/oauth proxy, key-test, intake. There is no production hard-fail: nothing asserts "refuse to start in prod without Supabase." Worse, `/api/health` returns `supabaseConfigured: supabaseEnabled` and `node: process.version` **unauthenticated** (health/route.ts:17,20), so an attacker can probe exactly when a deployment is in fail-open mode and what Node version to target.
- **Impact:** Single missing env var ⇒ complete auth/authz/tenant bypass + admin on a candidate-PII console. This is the textbook "demo-mode-no-auth path shipped to prod" risk.
- **Likelihood:** Misconfiguration of env vars on a serverless platform is a *common* operational error; the app gives no guardrail and actively advertises the state.
- **Reproduction:** Deploy with `NEXT_PUBLIC_SUPABASE_URL` unset → `GET /api/health` shows `supabaseConfigured:false` → `GET /api/hermes/proxy?upstreamPath=api/oauth/account` returns upstream data with no session; `POST /api/keys` etc. all authorize.
- **Test that would settle it:** Integration test asserting that in a production build (`NODE_ENV=production`) with Supabase env absent, every `/api/*` mutating route returns 401/503 (not 200), and a boot-time invariant that hard-fails prod without Supabase.
- **Recommended fix:** Add a production guard: if `NODE_ENV==="production"` and `!supabaseEnabled` → fail closed (refuse to serve protected routes / refuse boot). Remove `supabaseConfigured` from the unauthenticated health payload.
- **Recommended status override:** the Phase-4 "auth/RBAC/admin" sub-PASSes → **FAIL** (conditional, no prod guard). **Status: OPEN.**
- **Owner:** Backend/Platform. **Residual risk:** HIGH until a prod hard-fail exists.

---

## HIGH

## [HIGH] OVERRIDE Gate 4 (Authorization): "Cross-workspace tenant isolation (BOLA/API1) = PASS" → UNKNOWN
- **Area / Affected:** `supabase/migrations/0005_rls_tenant_isolation.sql` (untracked), `src/lib/supabase/workspace.ts:38-76`; AUTHORIZATION_MATRIX.md
- **Optimistic claim:** "RLS workspace_id scoping on all 8 tables … Source verified" → PASS.
- **Counter-argument:** The reviewer's own evidence ends with *"live-DB application UNKNOWN (no DB access)."* Tenant isolation is the single most important multi-tenant control, the operating rules say **untested ≠ PASS**, and there is **zero negative test** (no pgTAP, no cross-tenant integration test; QA confirms 0/15 server entry points executed). The RLS design that the PASS rests on lives in **migration `0005`, which is untracked in git** (`git ls-files supabase/` returns only `0001-0003`) — so the isolation may not even be present in a release cut from the committed tree. A "PASS" here will be read as "tenant isolation is proven." It is not proven; it is a source design review of an uncommitted file.
- **Test that would settle it:** Seed a local Supabase, create two workspaces + a member each, attempt cross-tenant `select`/`update` on `workspace_state`, `api_keys`, `outreach_ledger`, `email_connections`; assert 0 rows / RLS denial. Run in CI.
- **Recommended status override:** **UNKNOWN** (design-reviewed, runtime-unverified, artifact-incomplete). **Status: OPEN.** Severity HIGH.

## [HIGH] OVERRIDE Gate 5 (Database): "RLS / tenant isolation (design) = PASS" → FAIL
- **Area / Affected:** `supabase/migrations/0005_rls_tenant_isolation.sql:164-181`
- **Optimistic claim:** RLS design is "genuinely strong / sound" → PASS.
- **Counter-argument:** The *same* migration the PASS celebrates contains an intra-tenant authz hole the PASS glosses over. The `workspace_state` UPDATE policy (0005:177-181) checks **only** `workspace_id = current_workspace_id()` — **no role predicate**. Because the entire app state (campaigns, candidate PII, outreach content, guardrails, compliance flags, settings) is one JSONB document per workspace, **any authenticated member including a `viewer` can overwrite the whole tenant's state and guardrails** (cross-confirmed by Authorization HIGH and Business-Logic BL-1). A control design that lets the lowest-privilege role rewrite the highest-sensitivity document is not "sound." Calling the design PASS overstates it. (Cross-tenant scoping may be fine; intra-tenant least-privilege is broken — and the gate title says "tenant isolation," which a reader will take as the whole isolation story.)
- **Test that would settle it:** RLS test where a `viewer` attempts `update workspace_state` → must be denied (it currently succeeds by design).
- **Recommended status override:** **FAIL** (design contains a known intra-tenant privilege hole; add a role predicate or normalize the blob). **Status: OPEN.** Severity HIGH.

## [HIGH] OVERRIDE Gate 5 (Database): "DB roles least-privilege = PASS" → UNKNOWN/FAIL (not in deployable artifact)
- **Area / Affected:** `supabase/migrations/0005_rls_tenant_isolation.sql:31-81` (untracked); `git ls-files supabase/` ⇒ only `0001-0003`
- **Optimistic claim:** "revoke all from anon,public + minimal authenticated grants + column-level withholding of secret/tokens" → PASS.
- **Counter-argument:** Every privilege-tightening clause cited (anon/public revokes, column grants withholding `secret`/tokens) lives **only in migrations `0004` and `0005`, which are untracked**. A deploy from the committed tree applies `0001-0003`, under which the broad `0002` catch-all policies (`agent_seats rw`, `outreach_ledger rw`) and the un-revoked anon role remain. The PASS describes a posture that **is not in the artifact that would ship.** Per the rules (verify against deployable build, untested/absent ≠ PASS) this cannot be PASS.
- **Test/action that would settle it:** Commit `0004`/`0005`, then prove via `supabase db reset` + role-grant introspection that anon has no table grants and `secret`/token columns are withheld.
- **Recommended status override:** **UNKNOWN** (PASS-as-designed, but non-deployable from committed source). **Status: OPEN.** Severity HIGH.

## [HIGH] OVERRIDE Gate 4 (API security): "Hermes proxy SSRF allow-list correctness = PASS" → UNKNOWN
- **Area / Affected:** `src/app/api/hermes/proxy/route.ts:103-117`, `src/lib/api/hermes-proxy.ts:23-30`, `src/lib/api/url.ts:47-61`
- **Optimistic claim:** "Env-only base URL + host allow-list + path allow-list + query-param allow-list … Supersedes prior G-3" → PASS.
- **Counter-argument (three disproofs):**
  1. **Redirect-follow SSRF.** Neither the proxy fetch (proxy/route.ts:112) nor the chat fetch sets `redirect: "manual"` (`grep "redirect:" src/app/api src/lib/api` ⇒ **none**). Node `fetch` defaults to *follow*. The allow-list is validated **once, on the env base URL** (hermes-proxy.ts:27), and **never on redirect targets.** A `3xx` from the upstream (or any allow-listed path that 302s) is followed server-side to an arbitrary host — including `169.254.169.254` — defeating the SSRF guard. The allow-list does not re-run at the resolved/redirected hop.
  2. **Unauthenticated in demo mode.** The whole auth block is `if (supabaseEnabled)` (route:38), so in fail-open mode the relay is an **unauthenticated** server-side request engine (cross-ref API F-01, Business-Logic BL-4).
  3. **Topology contradiction = unverified prod config.** `url.ts:47-61` allow-lists **only** private/loopback hosts (`localhost`, `127.0.0.1`, `10/172.16-31/192.168`, `hermes`, `gateway`, `host.docker.internal`). The test even asserts `isAllowedHermesUrl("https://example.com")===false` (security-audit.mts:55). From Vercel `cdg1` serverless **none of these are reachable**, so to function in prod the allow-list must be widened to a public host — which the audited code does **not** do. Either Aria is unreachable in prod or the deployed allow-list differs from the repo. Either way the **shipping** SSRF posture is unverified.
- **Test that would settle it:** (a) Point `HERMES_API_URL` at a stub that 302s to `http://169.254.169.254/` and confirm the proxy refuses to follow; (b) document the real prod Aria host and re-validate the allow-list against it.
- **Recommended status override:** **UNKNOWN** (allow-list *logic* is fine in isolation; the *as-deployed SSRF posture* is unverified and has an open redirect-follow gap). **Status: OPEN.** Severity HIGH.

## [HIGH] OVERRIDE Gate 4 (Authorization): "Admin-only mutating routes = PASS" → FAIL (fails open)
- **Area / Affected:** `src/lib/supabase/server.ts:21-23`, `src/app/api/hermes/proxy/route.ts:38,55-60`, `src/app/api/keys/test/route.ts:26-28`
- **Optimistic claim:** "requireAdmin on keys POST/DELETE, OAuth callbacks, proxy mutations …" → PASS.
- **Counter-argument:** `requireAdmin` returns admin in demo mode (server.ts:21-23) and the proxy admin gate is inside `if (supabaseEnabled)`. So "admin-only" holds **only** when Supabase is configured — see the CRITICAL above; there is no prod guard. Separately, `/api/keys/test` runs the **value-path before any auth** (keys/test/route.ts:26-28 returns at line 28; `requireAdmin` is only at :43) — an unauthenticated reachable endpoint even in live mode. The PASS does not account for either.
- **Test that would settle it:** Negative authz tests: viewer/anon hitting each admin route returns 403/401 in live mode AND in a prod build without Supabase env.
- **Recommended status override:** **FAIL** (conditional admin-gating + one pre-auth path). **Status: OPEN.** Severity HIGH.

## [HIGH] OVERRIDE Gate 4 (API security): "Per-endpoint authorization (RBAC) = PASS" → conditional / under-evidenced
- **Area / Affected:** all `src/app/api/**/route.ts` `if (supabaseEnabled)` guards; `tests/rbac-keys.mts`
- **Optimistic claim:** "rbac-keys.mts 23/0 pass. Supersedes prior G-2." → PASS.
- **Counter-argument:** `rbac-keys.mts` tests the **pure `can()` lookup table only** — it never invokes a route handler (QA confirms 0/15 server entry points executed at runtime). Route-level RBAC enforcement is therefore **unproven**, and is **fully bypassed in demo mode**. A green unit test on a permission matrix is not evidence that the handlers consult it correctly. PASS overstates assurance.
- **Test that would settle it:** Handler-level tests invoking each route as each role and asserting status codes.
- **Recommended status override:** **UNKNOWN** at the route/runtime level (matrix-PASS, enforcement-unverified). **Status: OPEN.** Severity HIGH.

## [HIGH] OVERRIDE (cross-cutting): "Anon key is designed-public / secrets withheld from client = PASS" is contingent on an unverified, untracked RLS
- **Which gates:** Gate 3 Frontend-Security "Client-side secret exposure (NEXT_PUBLIC_*) = PASS"; Gate 5 Data-Protection "Secrets withheld from client = PASS."
- **Area / Affected:** `src/lib/supabase/config.ts:10-11`, `0005_rls_tenant_isolation.sql` (untracked)
- **Optimistic claim:** anon key is "RLS-protected, designed-public."
- **Counter-argument:** The anon key is shipped to every browser. Its safety is **entirely** a function of RLS being applied — which is runtime-unverified (Gate 5 "RLS verified by test = FAIL") and whose hardening migration is **untracked**. If RLS is not applied (or `0005` not deployed), the public anon key is a **direct, internet-reachable read path to all tenant candidate PII**. The frontend reviewer itself notes this PASS is "contingent on Supabase RLS being enforced." A contingent PASS on an unproven control should not read as PASS.
- **Recommended status override:** **UNKNOWN** until RLS is test-verified on a deployed/seeded DB with `0005` committed. **Status: OPEN.** Severity HIGH.

## [HIGH] OVERRIDE (meta, cross-cutting): every "green" gate is unbound to a deployable artifact — dirty tree, untracked security migrations, no CI execution
- **Which gates:** Gate 9 QA typecheck/test/lint/build PASS; all source-PASS verdicts across Phases 3-6.
- **Area / Affected:** `git status` (60+ modified, `0004`/`0005`/`config.toml` untracked); `git remote -v` empty; `.github/workflows/ci.yml` (never executed)
- **Optimistic claim:** "typecheck 0, lint clean, build 0, 705/705 tests" → PASS.
- **Counter-argument:** These are **local-only** results on an **uncommitted** tree. There is **no git remote**, so `ci.yml`/`codeql.yml`/`gitleaks` have **never run** — the green pipeline is hypothetical. The two security-critical migrations are uncommitted, so the build that produced the green results is **not the build that would ship**. No release SHA exists. Per the operating rule "re-validate findings against a committed/tagged build before sign-off," none of the source-PASS verdicts are currently bound to a releasable artifact.
- **Recommended status override:** Treat all source-PASS verdicts as **provisional / UNKNOWN-at-pipeline-level** until a committed, tagged build passes CI on a real remote. **Status: OPEN.** Severity HIGH.

---

## MEDIUM

## [MEDIUM] OVERRIDE Gate 4 (API security): "Versioning / idempotency / pagination = PASS" → FAIL (idempotency is on dead code)
- **Area / Affected:** `src/app/api/outreach/send/route.ts` (no callers), `src/lib/store.ts:787` (`approveOutreach`)
- **Optimistic claim:** "Outreach idempotent via claim_and_record de-dupe."
- **Counter-argument:** `grep -rn "outreach/send" src/` (excluding the route file) returns **nothing** — the server send route with the atomic `claim_and_record` idempotency has **zero callers** (cross-ref Business-Logic BL-3). The client store only ever fetches `/api/keys`, `/api/keys/test`, `/api/hermes/chat` (store.ts). The **actually-used** path is client-side `approveOutreach` (store.ts:787), which Business-Logic BL-6 shows has **no idempotency guard** (replay double-counts contacts/quota). So the idempotency PASS is awarded to unreachable code while the live path is non-idempotent.
- **Recommended status override:** **FAIL/MEDIUM** (idempotency not present on the wired path). **Status: OPEN.**

## [MEDIUM] OVERRIDE Gate 5 (Data Protection): "Encryption in transit = PASS" → UNKNOWN (contradicts Database reviewer)
- **Area / Affected:** `supabase/config.toml:84` (`# [db.ssl_enforcement]` commented out), Database review "Encryption in transit = UNKNOWN"
- **Optimistic claim:** "All upstreams HTTPS … Vercel TLS" → PASS.
- **Counter-argument:** Two reviewers reach opposite verdicts on the **same** control. The Database reviewer marks in-transit **UNKNOWN**: `config.toml` `db.ssl_enforcement` is commented out (:84-85), direct-connection `sslmode` is not pinned in repo, and prod managed TLS is unverified (no live access). App-to-PostgREST over HTTPS is only part of the path; direct DB connections and enforced SSL are unproven. Conservative reconciliation = UNKNOWN, not PASS.
- **Recommended status override:** **UNKNOWN.** **Status: OPEN.**

## [MEDIUM] OVERRIDE (cross-cutting): test-based PASSes overstate assurance — static-regex security tests with a self-defeating escape hatch, never run in CI
- **Which gates:** Gate 3 Frontend-Security "Build/typecheck/security tests = PASS"; Gate 4 various "tests pass"; Gate 9 "test (22 suites) = PASS."
- **Area / Affected:** `tests/security-audit.mts:52,55`; no git remote (tests never ran in CI); sandbox bypass required (tsx IPC EPERM)
- **Optimistic claim:** "test:security = 87 assertions, 0 failures" is cited as security evidence.
- **Counter-argument:** `security-audit.mts` is **static text regex over source**, not behavioral. The api_keys-secret assertion (line 52) is `!/…secret/.test(...) || /…select\("provider, secret/.test(...)` — a built-in **`||` escape hatch**: if the code *does* select the secret in the `"provider, secret"` shape, the test passes anyway. The "SSRF blocks public host" assertion (line 55) encodes the **prod-unreachable** topology as a *desired* invariant. These tests can be green while the property they claim to protect is violated. And because there is no remote, **none of these tests have executed in CI** — green is a local claim only. typecheck/lint/build are fine as *local* facts but are not pipeline-verified.
- **Recommended status override:** the "security tests prove security" framing → **UNKNOWN** at pipeline level; keep typecheck/lint/build as local-PASS only. **Status: OPEN.**

---

## LOW

## [LOW] OVERRIDE Gate 5 (Data Protection): "Password storage = PASS" → UNKNOWN
- **Area / Affected:** `src/app/api/auth/demo-login/route.ts:27` (`?? "admindemo123"`), `supabase/config.toml:182` (`minimum_password_length = 1`)
- **Optimistic claim:** "No custom passwords; auth via Supabase … Supabase-side hashing not in repo (standard, not verifiable here)" → PASS.
- **Counter-argument:** The reviewer literally states the control is **not verifiable here** — by the operating rules, unverifiable = UNKNOWN, never PASS. Supporting signals against PASS: a hardcoded fallback password `admindemo123` (prod-disabled, but live in any non-prod build) and `minimum_password_length = 1` in `config.toml` (untracked, local). Marking PASS on an explicitly unverifiable control is exactly the "looks fine" pattern this gate hunts for.
- **Recommended status override:** **UNKNOWN.** **Status: OPEN.**

## [LOW] CHALLENGE Gate 3 (Frontend-Perf): "3D render-loop memory profile = PASS" → keep PASS but note it is code-read, not measured
- **Area / Affected:** `src/.../agentTick.ts:203`, `AgentModel.tsx:107`; Core Web Vitals UNKNOWN
- **Counter-argument:** The PASS is a static read of the animation loop (ref-based, dpr capped). No profiler/heap-snapshot/soak was run, and the reviewer notes "per-frame array/Map allocs." It is a reasonable design-PASS, but a reader should not treat it as a *measured* no-leak guarantee. Not an override (low risk); flag as evidence-grade caveat. **Status: ACCEPTED (with caveat).**

---

## Summary of recommended overrides

| # | Gate (reviewer PASS being challenged) | Current | Red-Team override | Severity |
|---|----------------------------------------|---------|-------------------|----------|
| 0 | Cross-cutting: fail-open demo mode shippable to prod | (unowned) | **FAIL / CRITICAL** | CRITICAL |
| 1 | G4 Authorization — Cross-workspace tenant isolation | PASS | **UNKNOWN** | HIGH |
| 2 | G5 Database — RLS/tenant isolation (design) | PASS | **FAIL** | HIGH |
| 3 | G5 Database — DB roles least-privilege | PASS | **UNKNOWN** | HIGH |
| 4 | G4 API — Hermes proxy SSRF allow-list correctness | PASS | **UNKNOWN** | HIGH |
| 5 | G4 Authorization — Admin-only mutating routes | PASS | **FAIL** | HIGH |
| 6 | G4 API — Per-endpoint authorization (RBAC) | PASS | **UNKNOWN** | HIGH |
| 7 | Cross-cutting: anon-key "designed-public"/secrets-withheld | PASS | **UNKNOWN** | HIGH |
| 8 | Meta: green gates unbound to deployable artifact | PASS | **UNKNOWN** | HIGH |
| 9 | G4 API — Versioning/idempotency/pagination | PASS | **FAIL** | MEDIUM |
| 10 | G5 Data-Protection — Encryption in transit | PASS | **UNKNOWN** | MEDIUM |
| 11 | Cross-cutting: test-based PASSes overstate assurance | PASS | **UNKNOWN** | MEDIUM |
| 12 | G5 Data-Protection — Password storage | PASS | **UNKNOWN** | LOW |

**Not challenged (PASS upheld):** XSS sinks absent; source-maps absent; open-redirect/clickjacking headers present; framer-motion scoping; 3D code-splitting; input-validation schemas present (zod); output encoding / no stack-trace leak; file-upload N/A; visible focus indicator; semantic landmarks; encryption-in-transit *for app→provider HTTPS* (the app-edge portion). These are concrete and evidence-backed; the only caveat is the meta/pipeline override (#8) applies to all of them.

## Blockers (what would settle the challenges)
1. **Live/seeded Supabase + committed `0004`/`0005`** to run cross-tenant + intra-tenant (viewer-write) RLS negative tests in CI — settles overrides #1, #2, #3, #7.
2. **A production hard-fail guard** against fail-open demo mode + a prod-config attestation that `NEXT_PUBLIC_SUPABASE_*` are set — settles #0, #5, #6.
3. **Redirect-follow control (`redirect:"manual"`) + documented prod Aria host** re-validated against the allow-list — settles #4.
4. **Git remote + committed/tagged build passing CI** (with `npm audit --audit-level=high` blocking) — settles #8 and #11.
5. **Live TLS/SSL-enforcement evidence** (Supabase `ssl_enforcement`, pinned `sslmode`) — settles #10.
