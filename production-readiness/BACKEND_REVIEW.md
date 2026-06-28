# Backend / API Review — MSourcing ("hermes-sourcing")

**Phase 4 — Backend.** Maps to **Gate 4 — Backend/API**.
**Reviewer:** Backend Engineer (production-readiness review)
**Date:** 2026-06-27
**Scope:** every API route handler / controller / service helper / OAuth callback; auth enforcement on protected routes; input validation (zod); output encoding; request-size limits; file-upload/content-type handling; error handling (no stack/secret leakage); concurrency / transaction safety / retries / timeouts / graceful degradation; the store mutation + debounced Supabase persistence race risk.

> **Audit basis:** the working tree is **DIRTY** (`git status` shows `M` on all four mutating API routes — `api/intake`, `api/keys`, `api/keys/test`, `api/outreach/send` — plus `next.config.mjs`, `package.json`, CI, and many pages). This review audits the **current on-disk tree as-is**, not HEAD (`35ce313`). Re-verify after the tree is committed.
> **Supersedes/extends:** this is a **new** deliverable (no prior `BACKEND_REVIEW.md` existed). It cross-references and does **not** contradict `SECURITY_REVIEW.md` (rate-limiting gap G-6 is preserved and re-scoped here as B-3) and `DATA_FLOW.md`.

---

## Executive summary

The backend is small (8 first-class API route files + 6 `/auth/*` OAuth routes) and, on the security-control axis, it is **noticeably above MVP hygiene**: every mutating route validates input with zod via a shared `validateBody` helper, checks auth **before** buffering the body, resolves secrets server-side and never returns them, applies a real SSRF allow-list to the Hermes/Aria proxy, enforces per-task RBAC, and pushes the send-safety invariants (suppression, daily cap, de-dupe) into an atomic Postgres RPC (`claim_and_record`). Output is generic-on-error; DB errors are logged server-side and not echoed. **All 22 test suites pass** and `tsc --noEmit` is clean.

The gate **fails**, not on auth/validation, but on **data-integrity, dependency, and reliability** axes that matter for the stated "real users + sensitive data" target:

1. **(HIGH) Lost-update / last-write-wins on the shared workspace document.** In LIVE mode the entire `HermesState` (candidates PII, outreach drafts, replies, ledger) is persisted as a **single JSON row per workspace**, upserted on a 600 ms debounce with **no version check / optimistic concurrency**. Two recruiters in the same workspace editing concurrently → the later debounced full-document upsert silently overwrites the earlier one's writes. This is a concrete multi-user data-loss path.
2. **(HIGH) Known-vulnerable framework dependency.** `next@14.2.35` — `npm audit` reports **4 high + 1 moderate** (2 of which, 1 high + 1 moderate, are in the production dependency tree): SSRF on WebSocket upgrades, cache-poisoning, DoS, CSP-nonce XSS. CI runs `npm audit` **non-blocking**, so this ships.
3. **(MEDIUM) No API-level rate limiting or cost cap** on the AI proxy/chat/intake/key-test routes (re-scoped G-6).
4. **(MEDIUM) Gmail MIME Subject header (CRLF) injection** — `subject` is not newline-sanitized before being placed into a raw MIME header.
5. **(MEDIUM) Stale `claimed` ledger rows** if the serverless function dies between `claim_and_record` and reconcile — a permanent de-dupe hold with no TTL/recovery.
6. **(MEDIUM) Unbounded body buffering**, **(MEDIUM) no `maxDuration`** vs a 30 s upstream timeout, **(MEDIUM) plaintext token/secret storage**, **(MEDIUM) OAuth connect `state` not session-bound**, **(LOW) upstream error-message leakage**.

**Gate 4 — Backend/API: FAIL** (2 HIGH open). Auth-enforcement, input-validation, and error-handling sub-checks individually PASS with evidence; concurrency, dependency, rate-limiting, and reliability sub-checks FAIL or are UNKNOWN.

---

## Gate decision

| Sub-check (Gate 4) | Status | Evidence |
|---|---|---|
| Auth enforced on protected routes | **PASS** | Every mutating route gates on `getServerSupabase().auth.getUser()` + RBAC before acting; `requireAdmin` on admin routes; `tests/rbac-keys.mts` (23) + `tests/hermes-proxy.mts` (11) pass |
| Input validation (zod) on all routes | **PASS** | `validateBody` + per-route schemas on chat/intake/keys/keys-test/outreach; `ProxyQuerySchema` on proxy; `tests/api-validation.mts` (17) pass |
| Output encoding / no stack-trace or secret leakage | **PASS (with LOW caveat)** | DB errors logged + generic message returned (`api/keys` L52-55); secrets never returned; **caveat B-10**: raw `err.message` returned on upstream fetch failure |
| Request size limits | **PARTIAL / MEDIUM** | Per-route `maxBytes` + proxy 1 MB cap exist, but enforced **after** full `arrayBuffer()` buffering (B-6) |
| File-upload / content-type restriction | **N/A** | No file-upload endpoint exists in the backend (verified — no `multipart/form-data`, no `formData()` parsing in `src/app/api`) |
| Concurrency / transaction safety | **FAIL** | Shared-doc last-write-wins (B-1); stale-claim hold (B-5) |
| Retries / timeouts / graceful degradation | **PARTIAL / MEDIUM** | `AbortSignal.timeout(30s)` everywhere + dry-run fallback are good, but no `maxDuration` (B-7) and no stale-claim recovery (B-5) |
| Dependency posture (exploitable deps) | **FAIL** | `next@14.2.35` high vuln, audit non-blocking (B-2) |
| Rate limiting / abuse + cost control | **FAIL** | None on AI/compute routes (B-3) |

**Overall Gate 4: FAIL** — open HIGH items B-1 and B-2.

---

## Findings

## [HIGH] B-1 — Shared workspace document persisted last-write-wins with no optimistic concurrency (multi-user lost update)
- **Area:** Store mutation + debounced Supabase persistence
- **Affected:** `src/lib/store.ts:400-421` (debounced persist), `src/lib/supabase/workspace.ts:63-76` (`saveRemoteState` upsert), `src/lib/store.ts:373-398` (hydrate)
- **Description:** In LIVE mode the **entire** `HermesState` (all campaigns, candidates + PII, outreach drafts, replies, suppression, ledger, settings) is held as **one JSON document keyed by `workspace_id`** in `workspace_state`. Every state change schedules a 600 ms-debounced `supabase.from("workspace_state").upsert({ workspace_id, state, updated_at }, { onConflict: "workspace_id" })`. The upsert sets `updated_at` but **never reads or compares it** — there is no version column, no `if-match`, no row-level merge. The document is read once at mount (`loadRemoteState`) and thereafter overwritten wholesale.
- **Impact:** Two users (or two tabs) in the same workspace editing concurrently → the second client's debounced flush replaces the entire document with **its** stale-at-read snapshot, silently discarding the first client's new candidates / drafts / reply classifications / ledger edits made in the same window. For a "shared multi-tenant recruiting console" this is routine, not a corner case → **data loss / integrity failure**. A long-idle tab that later fires one mutation will clobber an hour of another user's work.
- **Likelihood:** High in any real multi-recruiter workspace.
- **Reproduction:** LIVE mode, same workspace, Tab A and Tab B both loaded. In A add candidate X (debounce flushes). In B (loaded before X) add candidate Y; B's 600 ms flush writes B's document (without X). Reload → X is gone.
- **Evidence:** `workspace.ts:67-70` upsert with no version predicate; `store.ts:411-413` `setTimeout(... saveRemoteState(wid, snapshot) , 600)` captures a full snapshot; no conflict-detection code anywhere (`grep -n "version\|updated_at\|onConflict" src/lib/supabase/workspace.ts`).
- **Recommended fix:** Move to an **optimistic-concurrency** model: add a monotonically increasing `rev`/`version` integer (or compare `updated_at`) and make the write a conditional update (`.eq("workspace_id", wid).eq("rev", loadedRev)`); on 0-rows-affected, reload + replay/merge and retry. Better: stop persisting one giant blob — split into per-entity tables with row-level RLS and write deltas, so independent edits don't collide. At minimum, add a Postgres RPC that does a server-side JSONB deep-merge instead of full replace.
- **Tests to add:** concurrency test simulating two snapshots writing against the same `rev` → second must be rejected/merged, not silently win.
- **Status:** OPEN
- **Owner:** Backend
- **Residual risk:** High until concurrency control exists; the whole product premise (shared console) is exposed.

## [HIGH] B-2 — Known-vulnerable framework dependency shipped (next@14.2.35), audit non-blocking in CI
- **Area:** Dependency / supply chain
- **Affected:** `package.json` (`"next": "^14.2.35"`), installed `next@14.2.35`; `.github/workflows/ci.yml` (audit step non-blocking)
- **Description:** `npm audit` reports **5 vulnerabilities (4 high, 1 moderate)**; `npm audit --omit=dev` still reports **2 (1 high, 1 moderate)** in the production tree. The `next` advisories include SSRF via WebSocket upgrades (GHSA-c4j6-fc7j-m34r), cache-poisoning in RSC responses (GHSA-wfc6-r584-vfw7, GHSA-vfv6-92ff-j949), DoS in Server Components (GHSA-8h8q-6873-q5fj) and Image Optimization (GHSA-h64f-5h5j-jqjh), and CSP-nonce XSS (GHSA-ffhc-5mcf-pf4q). The documented fix is `next@16` (breaking).
- **Impact:** This app **is** an SSRF-adjacent proxy and uses CSP with `'unsafe-inline'`; several of these advisories are directly in the threat surface (SSRF, cache-poisoning, XSS). An exploitable framework vuln in a sensitive-data app is HIGH.
- **Likelihood:** Medium — depends on exact deployment surface; SSRF/cache-poison classes are network-reachable.
- **Reproduction:** `npm audit` → `5 vulnerabilities (1 moderate, 4 high)`; `npm ls next` → `next@14.2.35`.
- **Evidence:** command output captured in `EVIDENCE_INDEX` / this review: `npm audit --omit=dev` → "2 vulnerabilities (1 moderate, 1 high)"; `npm audit` → "5 vulnerabilities (1 moderate, 4 high)".
- **Recommended fix:** Plan the `next@15`/`16` upgrade (test the App Router + middleware + proxy). Until then, pin the latest patched 14.2.x that addresses the SSRF/cache-poisoning advisories if one exists, and **make the CI `npm audit` step blocking for high+ on production deps** (it is currently non-blocking).
- **Tests to add:** CI gate: `npm audit --omit=dev --audit-level=high` must exit non-zero on regression.
- **Status:** OPEN
- **Owner:** Backend / Platform
- **Residual risk:** High while running a vulnerable framework on a public surface.

## [MEDIUM] B-3 — No API-level rate limiting or cost cap on AI/compute routes (re-scopes SECURITY_REVIEW G-6)
- **Area:** Abuse / availability / cost control
- **Affected:** `src/app/api/hermes/chat/route.ts`, `src/app/api/hermes/proxy/route.ts`, `src/app/api/intake/route.ts`, `src/app/api/keys/test/route.ts`
- **Description:** No route applies per-user/IP rate limiting. `grep -rn "rate.?limit|429" src/` finds only an unrelated LinkedIn-policy regex. The send path is capped by `claim_and_record` (per-seat daily cap, atomic) — but the **AI text-generation** path (`hermes/chat`, cloud provider branch) has no cap. An authenticated `member` can loop `/api/hermes/chat` and burn real Anthropic/OpenAI/Groq spend (keys resolved from the vault/env server-side) or exhaust the Aria sidecar. `/api/intake` runs regex-heavy parsing (`parseEmailAndJD`) on up to 64 KB and is **open** in demo mode.
- **Impact:** Cost blow-up (LLM spend) and availability degradation from a single authenticated account; no circuit breaker.
- **Likelihood:** Medium (insider/compromised session).
- **Reproduction:** Authenticated loop on `/api/hermes/chat` with `provider:"anthropic"` → unbounded upstream calls.
- **Evidence:** absence — no limiter import/middleware; `grep` clean. Cross-ref `SECURITY_REVIEW.md:150` (G-6, Medium).
- **Recommended fix:** Add a sliding-window limiter keyed by Supabase user id (Upstash Redis / Vercel KV) in `middleware.ts` or a shared wrapper; add a per-workspace daily AI-spend ceiling and return `429`.
- **Tests to add:** limiter unit test (N+1 within window → 429).
- **Status:** OPEN (carried from G-6)
- **Owner:** Backend
- **Residual risk:** Medium.

## [MEDIUM] B-4 — Gmail MIME `Subject` header (CRLF) injection
- **Area:** Output encoding / email header injection
- **Affected:** `src/lib/email-oauth.ts:168-193` (`buildMimeMessage`), reached from `src/app/api/outreach/send/route.ts:160`; schema `OutreachSendSchema.subject = z.string().min(1).max(255)` (`outreach/send/route.ts:18`)
- **Description:** For Gmail-API seats the route builds a **raw MIME message** and base64url-encodes it. `subject` is interpolated directly into a header line — `` `Subject: ${req.subject}` `` — with **no CRLF/newline stripping**. The zod schema bounds length but allows `\r\n`. A subject like `Role\r\nBcc: exfil@attacker.tld` injects an extra header into the outbound message. (`to` is `z.string().email()` so it is safe; `from` is the server-controlled seat mailbox; Microsoft Graph uses JSON so it is **not** affected — Gmail path only.)
- **Impact:** An authenticated `outreach`-permitted user with a live, domain-verified Gmail seat could BCC candidate outreach to an arbitrary address (silent exfiltration of recruiter↔candidate comms) or inject other headers. Gated behind a fully live seat + `confirmLive`, so insider-only — but it defeats the "From is the seat, never the body" hardening for everything except the From line.
- **Likelihood:** Low–Medium (requires a live Gmail seat + outreach perm).
- **Reproduction:** Live Gmail seat; POST `/api/outreach/send` with `subject` containing `\r\nBcc: x@y.z` and `confirmLive:true`.
- **Evidence:** `email-oauth.ts:171-178` headers array includes `` `Subject: ${req.subject}` `` with no sanitizer; no `replace(/[\r\n]/g, "")` anywhere in the MIME builder.
- **Recommended fix:** Strip/reject CR and LF in `subject` (and any header-bound field) — e.g. `subject.replace(/[\r\n]+/g, " ")` in `buildMimeMessage`, and add `.regex(/^[^\r\n]+$/)` to the zod schema. RFC 2047-encode non-ASCII subjects.
- **Tests to add:** unit test: subject with embedded CRLF must not produce >1 `Subject:`/any injected header.
- **Status:** OPEN
- **Owner:** Backend
- **Residual risk:** Medium until sanitized; must be fixed before any live Gmail send.

## [MEDIUM] B-5 — Stale `claimed` outreach-ledger rows on mid-send crash (no TTL / recovery)
- **Area:** Transaction safety / reliability
- **Affected:** `src/app/api/outreach/send/route.ts:96-118` (claim → reconcile)
- **Description:** The flow is: `claim_and_record` inserts a ledger row in state `claimed` (holding the de-dupe slot), the provider send runs, then `reconcile()` updates the row to `sent` or `skipped`. There is **no transaction spanning the external send**, and the reconcile is a best-effort second round-trip. If the serverless function is killed (OOM, platform timeout — see B-7) **after** the claim but **before** reconcile, the row stays `claimed` forever. The de-dupe logic then treats the candidate as already contacted and **permanently blocks re-contact**, even though nothing was sent.
- **Impact:** Silent under-delivery — candidates stuck in a phantom "claimed" state; no automatic recovery; the comment "a failed send is retryable" only holds if reconcile actually runs.
- **Likelihood:** Medium (any timeout/crash during the external provider call).
- **Reproduction:** Force the function to exceed `maxDuration` during the provider `fetch`; the ledger row remains `claimed`.
- **Evidence:** `outreach/send/route.ts:112-118` reconcile is a separate post-send UPDATE; no `claimed`-state TTL / sweeper found (`grep -rn "claimed" src/` → only this route).
- **Recommended fix:** Add a `claimed_at` timestamp and a scheduled sweeper (or a `claim_and_record` TTL) that releases `claimed` rows older than N minutes; or make the claim a short reservation that auto-expires unless confirmed. Consider an outbox pattern (durable queue) so the send is idempotently retried.
- **Tests to add:** simulate crash-after-claim → assert the slot is reclaimable after TTL.
- **Status:** OPEN
- **Owner:** Backend
- **Residual risk:** Medium.

## [MEDIUM] B-6 — Request bodies fully buffered into memory before the size cap is checked
- **Area:** Request size limits / DoS
- **Affected:** `src/lib/api/validate.ts:19-24`, `src/app/api/hermes/proxy/route.ts:104-110`
- **Description:** `validateBody` deliberately ignores `Content-Length` (correctly, since it is spoofable) and instead does `const buf = await req.arrayBuffer(); if (buf.byteLength > maxBytes) ...`. That means the **entire** body is read into memory **before** the cap is enforced — the cap rejects, but only after buffering. The proxy route does the same (`await req.arrayBuffer()` then `byteLength > 1_048_576`).
- **Impact:** On a self-hosted `next start` (no Dockerfile/platform body cap present in repo — confirmed no infra files), a large body causes proportional memory use before rejection → memory-exhaustion DoS. On Vercel the platform ~4.5 MB function body limit mitigates it, but the repo doesn't pin that and self-host has no limit.
- **Likelihood:** Low–Medium (depends on deploy target; Vercel-mitigated).
- **Reproduction:** Self-host; POST a multi-hundred-MB body to `/api/intake` → server buffers it.
- **Evidence:** `validate.ts:19` reads full buffer first; comment at `validate.ts:17-18` confirms the Content-Length pre-check was intentionally removed.
- **Recommended fix:** Stream-read with an early abort once the byte counter exceeds `maxBytes` (read the body as a stream, accumulate, bail at the limit), or enforce a hard reverse-proxy/platform body limit and document it.
- **Tests to add:** oversized-stream test asserting early abort without full buffering.
- **Status:** OPEN
- **Owner:** Backend / Platform
- **Residual risk:** Low on Vercel, Medium self-hosted.

## [MEDIUM] B-7 — No `maxDuration` on serverless routes; 30 s upstream timeout can exceed the platform function timeout
- **Area:** Timeouts / graceful degradation
- **Affected:** all `src/app/api/**/route.ts` (only `health` sets `dynamic`); `hermes/chat` `UPSTREAM_TIMEOUT_MS = 30_000`; `hermes-proxy` `HERMES_PROXY_TIMEOUT_MS = 30_000`
- **Description:** No route exports `maxDuration`. `grep -rn "maxDuration" src/app/api` → none. The AI/proxy fetches use `AbortSignal.timeout(30_000)`, but Vercel's default function timeout (10 s on Hobby; configurable) can be **shorter** than 30 s, so the platform kills the function before the app's own abort fires. For streaming AI responses this truncates the stream; for `outreach/send` it can kill the function mid-flight (feeding B-5).
- **Impact:** Truncated AI streams, killed sends with no reconcile, unpredictable behavior under load.
- **Likelihood:** Medium.
- **Evidence:** absence of `maxDuration`; abort set to 30 s in `hermes/chat/route.ts:68` and `hermes-proxy.ts:10`.
- **Recommended fix:** Set an explicit `export const maxDuration` per route (≥ the upstream timeout) and align the `AbortSignal.timeout` to be **less** than `maxDuration` so the app times out cleanly first and can run reconcile/cleanup.
- **Tests to add:** N/A (config); verify via deploy config review.
- **Status:** OPEN
- **Owner:** Backend / Platform
- **Residual risk:** Medium.

## [MEDIUM] B-8 — OAuth mailbox tokens and provider API keys stored in plaintext columns (no app-level encryption)
- **Area:** Secret handling at rest
- **Affected:** `src/app/api/keys/route.ts:48-51` (`api_keys.secret`), `src/app/auth/google/callback/route.ts:103-116` + `src/app/auth/microsoft/callback/route.ts` (`email_connections.access_token` / `refresh_token`)
- **Description:** Provider API keys and OAuth mailbox access/refresh tokens are written to Supabase **as cleartext columns**. Protection relies entirely on Postgres RLS + Supabase's at-rest disk encryption + the service-role key staying secret. There is no application-level envelope encryption (e.g. KMS-wrapped column) and no separation between "metadata readable by the app" and "secret only decryptable server-side."
- **Impact:** Any path that bypasses RLS (the service-role client is used in several routes), a SQL-injection in an unrelated query, a leaked service-role key, or a DB backup exfiltration yields **plaintext mailbox tokens (full Mail.Send) and LLM/provider keys**. For an app whose sensitive data explicitly includes "OAuth mailbox tokens, API keys," this is below the L3 bar for the sensitive-data parts.
- **Likelihood:** Low (requires DB/service-role compromise) but **impact is severe** (mailbox takeover).
- **Evidence:** `keys/route.ts:50` inserts `secret: value` raw; `google/callback/route.ts:109-110` upserts `access_token` / `refresh_token` raw; no crypto import in these paths.
- **Recommended fix:** Encrypt secrets at the application layer before insert (KMS/`pgsodium`/`pgcrypto` with a key **not** stored in the DB), decrypt only at the immediate call site (`resolveVaultSecret` / `resolveHermesBearerToken`). Document key custody + rotation.
- **Tests to add:** assert stored column is ciphertext, not the input value.
- **Status:** OPEN
- **Owner:** Backend / Security
- **Residual risk:** Medium–High on DB compromise.

## [MEDIUM] B-9 — OAuth connect `state` is unsigned and not bound to the session (no CSRF nonce)
- **Area:** OAuth flow integrity / CSRF
- **Affected:** `src/app/auth/google/route.ts:31` and `microsoft/route.ts` (state = `base64url(JSON.stringify({seatId, provider}))`); callbacks `google/callback/route.ts:31-40`, `microsoft/callback/route.ts:31-40`
- **Description:** The OAuth `state` carries only `{seatId, provider}`, base64-encoded, **not signed and not bound to a per-session nonce**. The callback decodes it and trusts `seatId` (then constrains it to the caller's workspace via `requireAdmin` + a `agent_seats.workspace_id === current_workspace_id` check). Standard OAuth CSRF protection (an opaque random `state` stored in the user session and compared on return) is absent.
- **Impact:** No cross-tenant write (workspace check blocks it) and the callback is admin-gated, so impact is limited. But within a workspace an admin could be induced (forged `state`) to bind a mailbox to an unintended seat, and the missing session-bound nonce means the flow doesn't meet the OAuth CSRF baseline.
- **Likelihood:** Low.
- **Evidence:** `google/route.ts:31` builds state with no nonce; callbacks never compare state against a session-stored value.
- **Recommended fix:** Generate a random nonce, store it in an HttpOnly cookie/session at initiation, embed it in `state`, and verify equality in the callback (in addition to the existing workspace check). Optionally HMAC-sign `state`.
- **Tests to add:** callback with a state whose nonce doesn't match the session cookie → rejected.
- **Status:** OPEN
- **Owner:** Backend
- **Residual risk:** Low.

## [LOW] B-10 — Upstream fetch error messages returned verbatim to the client
- **Area:** Error handling / info leakage
- **Affected:** `src/app/api/hermes/chat/route.ts:180-182,242-244,271-273` and `hermes/proxy/route.ts:134-138` (`reason: msg` where `msg = err.message`)
- **Description:** On a network/fetch failure the routes return the raw `err.message` to the caller (e.g. `getaddrinfo ENOTFOUND internal-host`, connection-refused with port). Stack traces are not leaked and DB errors are already masked, but raw network errors can disclose internal hostnames/IPs/ports of the Aria/Hermes sidecar.
- **Impact:** Minor internal-topology disclosure. The upstream host is env-controlled (operator's own), so exposure is limited.
- **Evidence:** `hermes/chat/route.ts:180` `const msg = err instanceof Error ? err.message : "Network error."` then returned in `reason`.
- **Recommended fix:** Log `err.message` server-side; return a generic `"Upstream unavailable."` to the client.
- **Status:** OPEN
- **Owner:** Backend
- **Residual risk:** Low.

---

## What is solid (verified strengths — no action, keep)

- **Auth-first ordering.** `hermes/chat` rejects unauthenticated callers **before** buffering the body (`route.ts:109-126`); demo-mode-with-live-upstream requires a `HERMES_PROXY_SECRET` bearer so the proxy isn't an open relay.
- **SSRF allow-list.** `src/lib/api/url.ts` blocks link-local/metadata/loopback and allows only explicit private ranges + named hosts; the proxy path is a strict allow-list (`hermes-proxy.ts:61-85`), and only an explicit safe query-param set is forwarded (`proxy/route.ts:97-100`). Covered by `tests/hermes-proxy.mts` (11 pass).
- **Per-task RBAC + admin gating.** `hermes/chat` maps task→permission (`route.ts:135-146`); `hermes/proxy` requires `manage_settings` for all mutating Aria-config methods with a tight non-admin POST allow-list (`proxy/route.ts:50-60`); `requireAdmin` on keys + OAuth init/callback. `tests/rbac-keys.mts` (23) pass.
- **Server-side secret resolution, never returned.** `resolveVaultSecret` / `resolveHermesBearerToken` read secrets via service-role scoped to the caller's workspace and never echo them; `api/keys` returns only `last4`/`id`.
- **Send-safety invariants in Postgres.** `claim_and_record` enforces suppression + re-contact window + per-seat daily cap + atomic de-dupe; From is taken from the seat, never the body (`outreach/send/route.ts:132`); demo mode never sends. `tests/guardrails.mts` (11) pass.
- **Consistent zod validation + generic DB errors.** Shared `validateBody`; DB errors logged with code, generic message to client (`api/keys/route.ts:52-55`).
- **Demo-login hard-disabled in production** (`auth/demo-login/route.ts:15`).
- **No file-upload attack surface** — no `formData()`/multipart parsing in the API tree.

---

## Verification evidence (commands run, this review)

| Check | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | **PASS** — clean, no errors |
| `npm test` (22 suites) | **PASS** — fleet 43, humanizer 41, mock-ai 35, mantu-intake 14, security-redos 9, scoring 149, skills 37, rules 42, roles-i18n 17, rbac-keys 23, api-validation 17, floor 11, guardrails 11, admin-config 46, hermes-live 32, linkedin-policy 12, hermes-proxy 11, security-audit 15, chat 21, audit-fixes 46, memory-soul 38, ai-provider 35 — **0 failed** (run with sandbox disabled; under sandbox `tsx` fails with `EPERM` creating its IPC pipe in `/tmp` — a sandbox limitation, not a test failure) |
| `npm audit --omit=dev` | **2 vulnerabilities (1 moderate, 1 high)** — `next@14.2.35` |
| `npm audit` (incl dev) | **5 vulnerabilities (4 high, 1 moderate)** |
| `npm ls next` | `next@14.2.35` |
| `grep -rn "rate.?limit\|429" src/` | no limiter (only unrelated LinkedIn-policy regex) |
| `grep -rn "maxDuration" src/app/api` | none |
| `grep -rn "formData\|multipart" src/app/api` | none (no file-upload surface) |
| `git status` | **DIRTY** — all 4 mutating API routes modified vs HEAD `35ce313` |

---

## Blockers (need decision / access to close)

- **B-1 fix direction** needs a product decision: optimistic-locking on the single blob vs. decomposing `workspace_state` into per-entity tables. Either is a non-trivial backend change.
- **B-2** needs a `next` major-upgrade window (breaking) and a CI policy change (make audit blocking).
- **B-8** needs a key-custody decision (KMS vs `pgsodium`) — and live Supabase access to verify current column contents (no live access authorized for this audit → at-rest encryption state is **UNKNOWN**, treated as plaintext per code).
- Live deploy config (Vercel function `maxDuration`, body-size limit) is **UNKNOWN — blocked on Vercel project access**; only `vercel.json` (region/headers) is in-repo.
