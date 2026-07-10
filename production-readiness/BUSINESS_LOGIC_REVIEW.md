# Business Logic Review — Phase 4 (Gate 4)

> SUPERSEDED by `STATUS.md` 2026-07-10 for current release posture. Historical 2026-06-27 evidence may contain stale stack versions, suite counts, migration ranges, and verdicts.


**Target:** MSourcing ("hermes-sourcing") — autonomous recruiting operations console
**Reviewer area:** Phase 4 — business-logic abuse: privilege escalation, workflow bypass, quota/guardrail bypass (anti-ban / per-account limits, suppression / do-not-contact, LinkedIn policy), race conditions, replay, inconsistent states, direct object manipulation in the client store.
**Repo root:** `/Users/tony/Library/CloudStorage/OneDrive-MantuGroup/Documents/TEST/MSourcing`
**Branch:** `main` — **working tree is DIRTY** (54 modified files staged/unstaged at review time, incl. all 8 API routes and the outreach/settings/fleet UI). This audit is of the **current working tree as-is**.
**Date:** 2026-06-27
**Maps to:** Gate 4 — business logic
**Supersedes:** No prior `BUSINESS_LOGIC_REVIEW.md` existed. This is the first issue. Cross-references `THREAT_MODEL.md` (T1/E sections), `BACKEND_REVIEW.md`, `RISK_REGISTER.md`, `SECURITY_REVIEW.md`.

---

## 1. Executive summary

MSourcing's "never auto-send / human-in-the-loop / coordinate-within-limits" safety model is **genuinely well-engineered on the one path that is server-enforced** — the Postgres `claim_and_record()` RPC (migration `0002_fleet.sql`) gives atomic de-dupe, per-seat daily caps, suppression, and a re-contact window, and the tenant-isolation RLS (`0005_rls_tenant_isolation.sql`) correctly blocks self-escalation and tenant-hopping at the database. All 7 business-logic-relevant test suites pass and typecheck is clean.

However, **the controls that the product actually exercises are not the server controls.** Three structural gaps undermine the guardrail story:

1. **The server-enforced live-send path is dead code.** `/api/outreach/send` (the only route that calls `claim_and_record`) has **zero callers** anywhere in the app. Every outreach action a user can actually take runs through the ~3030-line client store (`approveOutreach`, `allocateOutreach`), which enforces rate limits, suppression and do-not-contact **entirely in the browser** against a JSON document the user fully controls.

2. **Operator-entered suppression / do-not-contact never reaches the server guardrail.** The UI writes suppressions and compliance flags into the shared `workspace_state` JSONB document; `claim_and_record` reads suppression only from the separate `suppression_list` table — which **no code path ever writes to.** The two halves of the compliance control are disconnected.

3. **The shared state document is writable by any workspace member regardless of RBAC role.** RLS on `workspace_state` checks workspace membership but **not role**, so a `viewer` (nominally read-only) can overwrite the entire tenant's settings, rate limits, approval-gate flag, suppression list and candidate compliance flags.

Add to that an **unauthenticated privilege-escalation path to the Aria runtime** in demo mode (`/api/hermes/proxy` skips its whole auth + admin gate when Supabase is disabled), **no API-level rate limiting** anywhere, and a **client-side replay gap** in outreach approval, and the business-logic layer is not production-ready.

**Net:** the email-sending blast radius is currently contained only by the accident that the live path is unwired and degrades to dry-run. The moment sending is enabled without wiring the server path and the `suppression_list` writes, several of these become CRITICAL compliance/anti-ban failures.

### Gate 4 decision: **FAIL**
Open HIGH findings: BL-1, BL-2, BL-4. Conservative posture per the audit rules (unverified/disconnected guardrail = FAIL, not PASS).

---

## 2. What was verified (evidence)

| Check | Result | Evidence |
|---|---|---|
| Atomic de-dupe / per-seat cap / suppression / re-contact window enforced server-side | PASS (DB layer) | `supabase/migrations/0002_fleet.sql:80-151` (`claim_and_record`), unique index `:55-58` |
| Self-role-escalation blocked at DB | PASS | `0001_init.sql:63-69`, `0005_rls_tenant_isolation.sql:142-150` (`role is not distinct from current_profile_role()`) |
| Tenant-hop blocked at DB | PASS | `0005:148` (`workspace_id is not distinct from current_workspace_id()`) |
| Secrets (api_keys.secret, OAuth tokens) withheld from `authenticated`, admin-write only | PASS | `0003_api_keys.sql:24-41`, `0004_email_connections.sql:24-42`, `0005:298-378` |
| Server outreach send re-checks role + seat ownership + live + domain | PASS (route logic, but route unused — see BL-3) | `src/app/api/outreach/send/route.ts:72-130` |
| LinkedIn automation/scrape blocked; guardrails locked | PASS | `src/lib/linkedin-policy.ts:15-65`; tests/linkedin-policy 12/12; tests/guardrails 11/11 |
| Booking refuses suppressed/DNC/unsubscribed | PASS | `src/lib/store.ts:1178-1180` |
| NEGATIVE reply auto-suppresses | PASS | `src/lib/store.ts:1130,1146-1148` |
| Per-task RBAC on Aria chat proxy (live mode) | PASS | `src/app/api/hermes/chat/route.ts:135-145` |
| Admin gate on mutating Aria proxy methods (live mode) | PASS (live only — see BL-4) | `src/app/api/hermes/proxy/route.ts:50-60` |
| Tests (business-logic subset) | PASS | fleet 43/0, rules 42/0, guardrails 11/0, linkedin-policy 12/0, rbac-keys 23/0, audit-fixes 46/0, security-audit 15/0 |
| TypeScript typecheck | PASS | `npx tsc --noEmit` → "No errors found" |
| `workspace_state` writes role-gated | **FAIL** | `0005:177-181` — no role predicate (BL-1) |
| Operator suppression/DNC reaches server guardrail | **FAIL** | no writer to `suppression_list`; `claim_and_record` ignores candidate flags (BL-2) |
| Server-enforced send path is on the user flow | **FAIL** | `/api/outreach/send` has no caller (BL-3) |
| Aria proxy authenticated in demo mode | **FAIL** | `proxy/route.ts:37-61` gated entirely by `if (supabaseEnabled)` (BL-4) |
| API-level rate limiting / replay throttle | **FAIL** | none in `src/lib/api/validate.ts` or any route (BL-5) |

Test command (run outside sandbox; tsx IPC pipe blocked under the default sandbox with `EPERM /tmp/.../tsx-501/*.pipe`):
`npx tsx tests/{fleet,rules-confidential,guardrails,linkedin-policy,rbac-keys,audit-fixes,security-audit}.mts`

---

## 3. Findings

### [HIGH] BL-1 — Shared workspace state is writable by any member regardless of role (viewer can mutate tenant guardrails & compliance state)
- **Area:** Tenant-internal authorization / direct object manipulation in the client store + its persistence.
- **Affected:** `supabase/migrations/0005_rls_tenant_isolation.sql:177-181` (`"members update state"`); `0005:170-173` (insert); `src/lib/supabase/workspace.ts:63-76` (`saveRemoteState` upsert of the whole document); `src/lib/store.ts:400-419` (debounced full-document persist).
- **Description:** The entire application state — `settings.rateLimits`, `settings.minScoreToContact`, `settings.humanApprovalGate`, `settings.dryRunMode`, every candidate's `complianceFlags` (`doNotContact`/`unsubscribed`/`suppressed`), the `suppression[]` array, `seats[]`, `ledger[]`, and `currentRole` — is stored as one JSONB document in `workspace_state`. The RLS UPDATE/INSERT policies authorize on `workspace_id = current_workspace_id()` **only**; there is no `current_profile_role()` predicate. Every authenticated workspace member therefore has full write access to the shared document, including a `viewer` (RBAC: `view` only — `src/lib/rbac.ts:32`). The browser writes the whole snapshot (`saveRemoteState` → `upsert`), and a member can equally issue the same upsert directly via the Supabase REST API with their own JWT.
- **Impact:** A nominally read-only viewer (or a member who should not touch settings) can: disable the human-approval gate, raise per-day rate limits to arbitrary values, set `minScoreToContact` to 0, **delete suppression entries**, and **clear `doNotContact`/`unsubscribed` on any candidate** — for the entire tenant. Because the only outreach flow users actually drive is the client store (see BL-3), these client-side guardrails are the *effective* guardrails, so this is a real guardrail/authorization bypass plus a shared-state integrity/availability risk (one user can corrupt or wipe operational state for everyone). Contradicts the documented model ("viewers are read-only; only admins manage settings, API keys, roles, fleet" — `src/components/settings/roles-panel.tsx:71-73`).
- **Likelihood:** High in live multi-user mode. The write capability is the documented persistence mechanism; no special tooling required.
- **Reproduction:** As a `viewer`-role member, in the browser console set any guardrail field on the store (or POST an upsert to `workspace_state` with the user JWT), e.g. flip `humanApprovalGate=false` and empty `suppression`; reload as another member and observe the changed shared state.
- **Evidence:** `0005:177-181`; `src/lib/supabase/workspace.ts:67-70`; `src/lib/rbac.ts:29-33`.
- **Recommended fix:** Move authoritative guardrail state out of the client-writable JSONB blob, OR split `workspace_state` into (a) a read-mostly operator-view doc and (b) admin-only settings, and add `current_profile_role() in ('admin'[,'member'])` predicates to the `workspace_state` write policies matching the documented RBAC. At minimum, guardrail-bearing fields (rate limits, approval gate, suppression, compliance flags) must be admin/member-write only and viewers `select`-only. Validate the document shape server-side (RPC with `SECURITY DEFINER` + per-field role checks) instead of a blind client upsert.
- **Tests to add:** RLS test asserting a `viewer` JWT cannot UPDATE `workspace_state`; a `member` cannot change `settings`/`suppression` if those become admin-only; store test that guardrail fields are not client-mutable in live mode.
- **Status:** OPEN
- **Owner:** Tony / backend
- **Residual risk:** High until role-gated; partially masked today because no live send consumes these client-side flags (BL-3).

---

### [HIGH] BL-2 — Operator suppression / do-not-contact never reaches the server guardrail (`suppression_list` is never written; `claim_and_record` ignores candidate flags)
- **Area:** Quota/guardrail bypass — suppression / do-not-contact / unsubscribe; inconsistent state across the client/server boundary.
- **Affected:** `src/lib/store.ts:1339-1382` (`suppressCandidate`, `markDoNotContact`, `unsubscribeCandidate`), `:1707-1739` (`addSuppression`/`removeSuppression`) — all write only to the in-memory/JSONB `state.suppression[]` and `candidate.complianceFlags`. Server enforcement: `supabase/migrations/0002_fleet.sql:99-108` (`claim_and_record` suppression check reads **`suppression_list`** table only). No application code inserts into `suppression_list` (verified: `grep -rn "suppression_list"` matches only the `.sql` files).
- **Description:** There are two suppression stores that never talk to each other. (1) The UI/store keeps suppressions in the workspace JSON document and candidate `complianceFlags`. (2) The server send guardrail (`claim_and_record`) consults the dedicated `suppression_list` Postgres table for email/domain suppression and the `outreach_ledger` for de-dupe — it does **not** read the candidate's `complianceFlags.doNotContact/unsubscribed` at all, and the `suppression_list` table is never populated by the app. So an operator who adds a suppression entry, marks a candidate do-not-contact, or honors an unsubscribe in the UI produces **no effect** on a server-side send.
- **Impact:** If/when the live send path is wired (BL-3) — or if any external integration calls `claim_and_record` directly — do-not-contact, unsubscribe and operator block-lists entered through the product would **not** block delivery. This is a direct CAN-SPAM / GDPR / CCPA do-not-sell / unsubscribe-enforcement failure on real PII. (Note `src/lib/seed.ts:2885` advertises `unsubscribeEnforcement: true`, `ccpaDoNotSell: true`, `gdprMode: true` — currently not enforced end-to-end.)
- **Likelihood:** Certain by construction the moment server sending is enabled; today contained only because the send route is unused.
- **Reproduction:** Trace `markDoNotContact(id)` → state only; then call `/api/outreach/send` for that candidate → `claim_and_record` queries `suppression_list` (empty) + ledger, returns `allowed:true`. No suppression hit.
- **Evidence:** `0002_fleet.sql:99-117`; `src/lib/store.ts:1339-1382,1707-1739`; absence of any `suppression_list` writer.
- **Recommended fix:** Wire suppression/DNC/unsubscribe mutations to persist into `suppression_list` (email + domain + linkedin) via a server route or RPC, and extend `claim_and_record` to also reject on the candidate's compliance flags (or persist those flags to a server table it reads). Make `suppression_list` the single source of truth and have the UI read from it. Add a startup reconciliation that imports existing JSON suppressions.
- **Tests to add:** integration test: add suppression in UI → `claim_and_record` returns `allowed:false reason:'suppressed'`; mark DNC → blocked; unsubscribe → blocked.
- **Status:** OPEN
- **Owner:** Tony / backend
- **Residual risk:** High (compliance) once sending is live; currently latent.

---

### [HIGH] BL-4 — Demo-mode Aria proxy bypasses all auth and the admin gate → unauthenticated privilege escalation to the Aria runtime
- **Area:** Privilege escalation / missing authorization on an important action (workflow bypass to admin config).
- **Affected:** `src/app/api/hermes/proxy/route.ts:37-61` — the entire auth check **and** the admin gate for mutating methods are wrapped in `if (supabaseEnabled) { ... }`. Allow-list includes admin Aria paths: `api/config`, `api/memory`, `api/schedules`, `api/tools`, `api/models`, `api/gateway` (`src/lib/api/hermes-proxy.ts:61-77`). All HTTP verbs are exported (`:141-145`).
- **Description:** In demo mode (`supabaseEnabled === false`, the app's self-described default per `package.json`), the proxy performs **no authentication and no admin check** before forwarding `GET/POST/PUT/PATCH/DELETE` to the upstream Aria runtime with the server's `HERMES_API_KEY` bearer token. Unlike the sibling chat route — which requires a `HERMES_PROXY_SECRET` shared secret in demo mode when `HERMES_API_URL` is set (`src/app/api/hermes/chat/route.ts:118-126`) — the proxy route has **no equivalent guard.** So a demo deployment that points at a live Aria runtime is an open, unauthenticated relay, and the privilege-escalation protection comment at `proxy/route.ts:45-49` ("closing a privilege-escalation path to Aria config") is inert in exactly the default configuration.
- **Impact:** Anyone who can reach the deployed instance can read and **mutate/wipe** the upstream Aria runtime configuration, memory, schedules, tools, and models via `PUT/PATCH/DELETE` — full takeover of the agent runtime, using the server's own credentials.
- **Likelihood:** High if a demo/preview deployment is given `HERMES_API_URL` + `HERMES_API_KEY` (a documented, supported configuration).
- **Reproduction:** With Supabase env unset and `HERMES_API_URL`/`HERMES_API_KEY` set: `curl -X DELETE "<host>/api/hermes/proxy?upstreamPath=api/memory"` — no auth required; request is forwarded with the env bearer token.
- **Evidence:** `src/app/api/hermes/proxy/route.ts:37-61,141-145` vs `chat/route.ts:118-126`.
- **Recommended fix:** Apply the same `HERMES_PROXY_SECRET` shared-secret check the chat route uses for demo mode, and enforce the admin-mutation gate unconditionally (or refuse mutating methods entirely when there is no auth backend). Fail closed when neither Supabase auth nor a proxy secret is configured.
- **Tests to add:** demo-mode test asserting `PUT/DELETE` to `api/config` without the proxy secret → 401/403; with secret + non-admin → 403.
- **Status:** OPEN
- **Owner:** Tony / backend (overlaps Backend/Security review)
- **Residual risk:** High in any demo deployment wired to a real runtime.

---

### [MEDIUM] BL-3 — Server-enforced live-send path is unwired; all real outreach runs through client-side-only guardrails
- **Area:** Workflow bypass / assurance gap (the documented safety control is not on the user path).
- **Affected:** `src/app/api/outreach/send/route.ts` (no caller — `grep -rn "outreach/send" src` returns only the route file and docs); the live flow users drive: `src/lib/store.ts:787-895` (`approveOutreach`), `:1743-1814` (`allocateOutreach`).
- **Description:** The route documented as "safe by construction" (auth + role + seat ownership + live + domain-verified + `claim_and_record` + `confirmLive`) is never invoked by the UI or any client wrapper. Every outreach action a user can perform is handled in the client store, where rate-limit, suppression, do-not-contact, dedupe and approval-gate checks are computed in the browser (`src/lib/rules.ts:35-81`, `src/lib/fleet.ts:190-272`) against the user-controlled state document. These client checks are trivially bypassable (BL-1) and, via `allocateOutreach`, write `status:"sent"` ledger entries that are explicitly dry-run (`store.ts:1770`).
- **Impact:** The strongest guardrails (Postgres-atomic) are not exercised by the product; the effective guardrails are client-side and bypassable. Currently low real-world harm because nothing actually sends (everything degrades to dry-run), but this is the load-bearing reason the other findings are "contained." Flipping to live without wiring this route + BL-2 would escalate BL-1/BL-2 to CRITICAL.
- **Likelihood:** N/A (latent); becomes High-impact on go-live.
- **Reproduction:** `grep -rn "outreach/send\|confirmLive" src` → only the route + Zod field; no fetch caller.
- **Evidence:** route file; absence of callers; `store.ts:1760-1772`.
- **Recommended fix:** Either wire the real outreach UI to `/api/outreach/send` (with `suppression_list` populated per BL-2) before any live send is possible, or gate the whole app so live mode is unreachable until the server path is the only send path. Document the invariant in code (e.g., a feature flag that hard-blocks client "send" when `supabaseEnabled`).
- **Tests to add:** e2e asserting that in live mode the only send path is the server route and the client store cannot mark a message truly "sent".
- **Status:** OPEN
- **Owner:** Tony
- **Residual risk:** Medium now; High on go-live.

---

### [MEDIUM] BL-5 — No API-level rate limiting / replay throttle on any route
- **Area:** Quota/abuse, replay, availability.
- **Affected:** `src/lib/api/validate.ts` (size + schema only, no throttle); all routes: `api/intake`, `api/hermes/chat`, `api/hermes/proxy`, `api/keys`, `api/keys/test`, `api/outreach/send`. `grep -rniE "rate.?limit|throttle|429"` over `src/app/api`, `src/middleware.ts`, `src/lib/api` → no matches.
- **Description:** No per-user, per-IP, or per-workspace rate limiting exists. `validateBody` caps body size but nothing caps request frequency.
- **Impact:** Cost-abuse of the LLM proxy (`hermes/chat` forwards to paid cloud providers via vault keys), brute-forcing/credential-probing on `keys/test`, and high-volume hammering of `claim_and_record`/ledger. An authenticated member (or, via BL-4, an unauthenticated demo caller) can run up cost and load unchecked.
- **Likelihood:** Medium.
- **Reproduction:** Loop POST `/api/hermes/chat` with `provider:"anthropic"`; observe no throttling.
- **Evidence:** `validate.ts` (whole file); negative grep.
- **Recommended fix:** Add per-identity + per-IP rate limiting (Upstash/Vercel KV token bucket or platform WAF rules) on all API routes, especially the LLM proxy and `keys/test`; return 429.
- **Tests to add:** route test asserting Nth rapid request → 429.
- **Status:** OPEN
- **Owner:** Tony / platform
- **Residual risk:** Medium.

---

### [MEDIUM] BL-6 — Outreach approval has no idempotency/status guard (client-side replay double-counts contacts & rate usage)
- **Area:** Replay / inconsistent state / quota integrity (client store).
- **Affected:** `src/lib/store.ts:787-895` (`approveOutreach`) — unlike `confirmManualSend` (`:897-903`, which checks `status !== "Pending Manual Send"`), `approveOutreach` does **not** check the message's current status before acting.
- **Description:** Re-invoking `approveOutreach` on the same message (stale UI, double-click, repeated programmatic call) re-runs the approval, appends a second `outreach_ledger` entry, re-stamps `lastContactedAt`, adds a second `outreachHistory` row, and increments `emailsSentToday`/`linkedinSentToday` again. The rate-limit check (`rules.ts:64-70`) only bounds the *aggregate* daily counter; it does not prevent a single message being approved/counted multiple times.
- **Impact:** Inflated/incorrect contact ledger and daily counters, double "contact" of one candidate in client state, skewed campaign metrics. Bounded to client state (server `claim_and_record` is idempotent via the unique index), and dry-run today — but it is a correctness/replay defect in the path users actually use.
- **Likelihood:** Medium (double-submit is common).
- **Reproduction:** Call `approveOutreach(id)` twice for a "Needs Approval" message; observe two ledger entries and counter +2.
- **Evidence:** `store.ts:787-895` (no status guard) vs `:897-906` (guarded).
- **Recommended fix:** Guard `approveOutreach` with an explicit allowed-from-status check (e.g., only `Needs Approval`/`Draft`), make the ledger write idempotent on `(messageId)`, and disable the approve control once status advances.
- **Tests to add:** store test asserting a second `approveOutreach` on the same id is a no-op (no duplicate ledger/counter).
- **Status:** OPEN
- **Owner:** Tony / frontend
- **Residual risk:** Low-Medium.

---

### [MEDIUM] BL-7 — Global fleet daily cap (anti-ban) enforced client-side only
- **Area:** Anti-ban / quota guardrail bypass.
- **Affected:** `src/lib/fleet.ts:208-211,244-247` (`globalDailyCap` enforced in `allocateBatch` only). `claim_and_record` enforces **per-seat** cap (`0002_fleet.sql:119-136`) but has no global/fleet-wide cap.
- **Description:** The fleet's global daily ceiling is honored only by the client allocator. The server claim has no notion of `globalDailyCap`, so any send path that calls `claim_and_record` directly (or a future wiring that loops per-seat) can exceed the configured fleet-wide anti-ban ceiling as long as each seat stays under its own cap.
- **Impact:** Coordinated over-sending beyond the intended fleet ceiling → deliverability/anti-ban risk the global cap was meant to prevent.
- **Likelihood:** Medium on go-live (per BL-3 currently unused).
- **Reproduction:** Set `globalDailyCap` low with many high-cap seats; drive `claim_and_record` per seat → total exceeds global cap.
- **Evidence:** `fleet.ts:208-211`; `0002_fleet.sql:119-136` (no global check).
- **Recommended fix:** Enforce `globalDailyCap` inside `claim_and_record` (count today's workspace ledger sends vs the configured global cap) so it cannot be bypassed client-side.
- **Tests to add:** RPC test: with global cap reached, `claim_and_record` returns `allowed:false`.
- **Status:** OPEN
- **Owner:** Tony / backend
- **Residual risk:** Medium on go-live.

---

### [LOW] BL-8 — LinkedIn-type suppression entries are not honored by `claim_and_record`
- **Area:** Suppression coverage.
- **Affected:** `supabase/migrations/0002_fleet.sql:99-108` — suppression check covers `type='email'` and `type='domain'` only; `type='linkedin'` (allowed by the table CHECK at `:33`) is ignored.
- **Description:** A `linkedin`-type suppression stored in `suppression_list` would not block a claim. Low impact because the send route only sends `channel:'Email'` (`outreach/send/route.ts:102`) and LinkedIn is assisted-manual; still an inconsistency if LinkedIn suppression is ever relied upon.
- **Impact:** Low (no LinkedIn auto-send path today).
- **Evidence:** `0002_fleet.sql:33,99-108`.
- **Recommended fix:** Either drop `linkedin` from the table CHECK or add handling, and document that LinkedIn suppression is enforced only in the assisted-manual UI flow.
- **Status:** OPEN
- **Owner:** Tony / backend
- **Residual risk:** Low.

---

### [LOW] BL-9 — Arbitrary candidate stage transitions (no workflow state machine)
- **Area:** Workflow bypass / inconsistent state (client store).
- **Affected:** `src/lib/store.ts:1298-1310` (`setCandidateStage`) — accepts any `stage` for any candidate with no transition validation; persisted client-side, no server validation.
- **Description:** Any stage can be set to any other (e.g., `Sourced → Hired` skipping outreach/booking/interview, or `Suppressed → Sourced`). Metrics recompute from whatever stage is set.
- **Impact:** Low — corrupts pipeline metrics/reporting; a `Suppressed → Sourced` move does **not** clear `complianceFlags`, so the fleet allocator still skips the candidate (`fleet.ts:224-227`), limiting real harm. No server enforcement exists, so it is wholly client-trusted.
- **Evidence:** `store.ts:1298-1310`; `fleet.ts:224-227`.
- **Recommended fix:** Enforce a stage transition map (allowed predecessors per stage) and forbid leaving `Suppressed`/`Not Interested` without an explicit compliance-clearing action; mirror server-side if/when persisted authoritatively.
- **Status:** OPEN
- **Owner:** Tony / frontend
- **Residual risk:** Low.

---

## 4. Positives worth preserving
- `claim_and_record` is a correct atomic guardrail: suppression + re-contact window + per-seat warm-up cap + unique-index de-dupe with `claimed`/`sent`/`pending_manual` accounting (`0002_fleet.sql`, `fleet.ts:154-177`). Keep this as the single send chokepoint.
- DB RLS prevents self-role-escalation and tenant-hop (`0005:130-150`); secrets are column-withheld and admin-write only (`0003/0004/0005`).
- LinkedIn policy module + locked guardrails + humanizer + confidentiality masking are present and tested.
- Booking and NEGATIVE-reply flows respect compliance flags client-side.

## 5. Blockers / required decisions
- **Decision needed:** Is live email sending in scope for v1, or is the product strictly dry-run? This determines whether BL-1/BL-2/BL-3/BL-7 are CRITICAL (live) or contained (dry-run). The audit treats them as HIGH because the code supports a live path that is one wiring change away.
- **Access needed:** None for this review (all evidence is in-repo). Verifying the *deployed* Supabase RLS actually matches `0005` (i.e., migrations were applied and not drifted) requires DB access → currently UNKNOWN-on-deploy; treat applied-RLS as unverified until confirmed.

## 6. Gate verdict
**Gate 4 — business logic: FAIL.** Three HIGH findings open (BL-1 viewer can mutate tenant guardrails; BL-2 suppression/DNC never reaches the server guardrail; BL-4 unauthenticated Aria-runtime privilege escalation in demo mode), plus structural assurance gap BL-3 and missing rate limiting BL-5. Do not promote to a live-send posture until BL-1–BL-4 are remediated and the server send path is the sole sending channel.
