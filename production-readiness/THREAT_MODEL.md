# Threat Model — Hermes Sourcing (MSourcing)

> SUPERSEDED by `STATUS.md` 2026-07-10 for current release posture. Historical 2026-06-27 evidence may contain stale stack versions, suite counts, migration ranges, and verdicts.


**Date:** 2026-06-27 (re-audited against the CURRENT working tree)
**Auditor role:** Threat Modeler (Phase 2)
**Framework:** STRIDE per trust boundary + OWASP Top 10 / API Security Top 10 mapping
**Gate:** Gate 2 — Threat model complete
**Scope:** Live (Supabase-enabled) deployment path; demo-mode divergences noted.

> **WORKING TREE IS DIRTY.** This model was produced against the uncommitted
> working tree (`git status` shows ~40+ modified files, incl. every API route,
> `next.config.mjs`, `.github/workflows/ci.yml`, `package.json`). The deployed
> artifact may differ from any committed SHA. Re-confirm against the exact
> release commit before sign-off. (Process risk — see RISK_REGISTER R-PROC.)

---

## What changed since the prior threat model (2026-06-27 v1)

Verified against current source. Several prior residuals are now closed in-tree:

| Prior item | Prior status | Current status (evidence) |
|---|---|---|
| T1.E.1 / G-2 — no role check on `/api/outreach/send` | OPEN | **FIXED** — `can(senderRole, "outreach")` at `outreach/send/route.ts:72-75`; per-task RBAC at `hermes/chat/route.ts:135-146` |
| T1.T.3 — `Content-Length` pre-check bypassable | OPEN | **FIXED** — `validateBody` now buffers actual bytes: `req.arrayBuffer()` + `buf.byteLength` cap (`api/validate.ts:19-24`) |
| T3.T.1 — proxy forwards arbitrary query params | OPEN | **FIXED** — explicit safe-param allowlist `["page","limit","cursor","q","level"]` (`hermes/proxy/route.ts:97-100`); admin gate on mutating methods (`:50-60`) |
| T2.I.1 — RLS policy unaudited | OPEN (highest risk) | **PARTIALLY ADDRESSED** — full RLS migration `0005_rls_tenant_isolation.sql` now present and design-sound; **runtime still UNVERIFIED** (no live RLS test). See I-RLS below. |
| T2.I.2 — secrets/tokens exposure | OPEN | **IMPROVED** — column-level grants withhold `secret` / `access_token` / `refresh_token` from `authenticated` (`0005` §10-11; `0003:24`); **plaintext-at-rest residual remains** (HIGH). |

New issues surfaced this pass: **OAuth seat-connection CSRF** (no state nonce),
**demo-mode chat open-relay**, **vulnerable Next.js (4 high advisories incl. SSRF)**,
**plaintext secrets at rest**, **no rate limiting anywhere**. Detailed below and
in RISK_REGISTER.md.

---

## System Overview & Trust Boundaries

Five principals across four trust boundaries:

```
Browser (operator)
    |  HTTPS  [TB-1]
    v
Next.js API Routes (Vercel serverless, region cdg1)
    |  [TB-2] anon/service-role        |  [TB-3] bearer
    v                                  v
Supabase (Postgres + Auth, RLS)    Hermes/Aria sidecar (Python aiohttp, private net)
                                       |  [TB-4]
                                       v
                                   LLM providers (Anthropic / OpenAI / Groq / xAI / Mistral)
```

**Critical control note — middleware does NOT protect API routes.** The
`src/middleware.ts` matcher explicitly excludes `api`
(`middleware.ts:67` → `"/((?!api|_next/static|...).*)"`). Every `route.ts` must
self-enforce auth/authz. Verified each route does its own `auth.getUser()` check
where a backend exists. In **demo mode** (`supabaseEnabled === false`,
`config.ts:13`) middleware is a no-op (`middleware.ts:13`) and most routes skip
auth by design — this is the central demo-vs-prod risk.

---

## TB-1: Browser ↔ Next.js API Routes

Auth: Supabase JWT in `HttpOnly` cookie (`@supabase/ssr`). Transport: HTTPS.

### S — Spoofing
- **T1.S.1 Session-cookie theft via XSS** — `script-src` carries both
  `'unsafe-inline'` and `'unsafe-eval'` (`next.config.mjs:12`, `vercel.json:11`).
  Cookie is `HttpOnly` (Supabase default) so it cannot be read by script, but a
  persistent XSS can still drive authenticated API calls in-session. No
  `dangerouslySetInnerHTML`/`innerHTML`/`eval` sinks found in `src/` (grep clean),
  so stored-XSS surface is low today — but `unsafe-eval` keeps the residual open.
  **Mitigation:** HttpOnly cookie + clean React rendering. **Residual: MEDIUM** —
  remove `unsafe-eval`/`unsafe-inline` (move to nonces/hashes).
- **T1.S.2 Demo-mode auth bypass deployed to prod** — if the app is deployed
  without `NEXT_PUBLIC_SUPABASE_*`, `supabaseEnabled` is false, middleware
  no-ops, and the entire console is open with localStorage persistence. **This is
  a deploy/config decision, not a code bug, but it is a CRITICAL-if-shipped path.**
  **Residual: HIGH at prod** — release gate must assert `supabaseEnabled` in the
  built artifact. (RISK_REGISTER R7.)

### T — Tampering
- **T1.T.1 Forced outreach send by under-privileged user** — *was* the top TB-1
  tamper risk; now **mitigated**: `/api/outreach/send` requires the `outreach`
  permission (`route.ts:72-75`), seat must be in-workspace + `live` +
  `domain_verified`, From is the seat mailbox (never the body), and
  `claim_and_record` (SECURITY DEFINER, atomic) enforces suppression/cap/dedupe
  (`route.ts:81-130`; `0002_fleet.sql:80-153`). **Residual: LOW.**
- **T1.T.2 Prompt injection via `/api/hermes/chat`** — user controls `prompt`
  (≤20 000 chars). System prompt is server-defined only (`TASK_SYSTEM`,
  `hermes/chat/route.ts:50-66`); `body.system` is never accepted. LLM output is
  never executed — only rendered as text or parsed into a validated struct, with
  fallback-to-mock on any parse failure. **Residual: LOW–MEDIUM** — a crafted
  reply could still bias the `classify` `intent` field and mis-stage a candidate.
- **T1.T.3 Oversized-body / chunked-encoding DoS** — **mitigated**: byte cap is
  enforced on actually-received bytes (`api/validate.ts:19-24`), not the
  spoofable `Content-Length`. Per-route caps: chat 32 KB, send 100 KB, intake
  64 KB, keys 8 KB, proxy 1 MB. **Residual: LOW.**

### R — Repudiation
- **T1.R.1 Audit trail not tamper-evident** — `outreach_ledger` now has **no
  client DELETE policy** (immutable from the client, `0005` §9) and inserts run
  through SECURITY DEFINER `claim_and_record`. But rows are not signed/hash-chained
  and the **service-role key bypasses RLS** and can rewrite/delete any ledger row.
  No separate, append-only, off-box audit log. **Residual: MEDIUM** — add
  tamper-evident/off-box audit for send + key + role-change events.

### I — Information Disclosure
- **T1.I.1 PII in validation errors** — `formatZodIssues` returns paths +
  messages, not values (`api/validate.ts:55-60`). **Residual: LOW.**
- **T1.I.2 Email addresses in structured logs** — `auditLog` in `providers.ts`
  logs `to`/`from` (`providers.ts:77,99,102,129`); `logUpstream`/`logHermesProxy`
  log task/path/status (no body). No PII redaction layer; depends on the (absent)
  log pipeline config. **Residual: MEDIUM at prod** — add field-level redaction.

### D — Denial of Service / cost
- **T1.D.1 LLM credit exhaustion / API abuse — NO RATE LIMITING ANYWHERE.**
  Grep for rate-limit primitives in `src/` returns only a LinkedIn-policy regex
  and a skills metric — there is **no per-user/IP/workspace rate limiter** on any
  route. An authenticated user can loop `/api/hermes/chat` to burn provider
  tokens/budget; `/api/intake` and (in demo) `/api/hermes/chat` are reachable
  unauthenticated. **Residual: MEDIUM today / HIGH at prod.** (RISK_REGISTER R-DOS.)

### E — Elevation of Privilege
- **T1.E.1 Non-admin reaching admin actions** — `/api/keys` (POST/DELETE) and
  `/api/keys/test` (stored-key path) call `requireAdmin` (`server.ts:18-36`).
  `/api/hermes/proxy` admin-gates all PUT/PATCH/DELETE and every POST except
  `v1/chat/completions` + `api/sessions` (`proxy/route.ts:50-60`).
  `/api/outreach/send` + chat now enforce permission-level RBAC. **Residual: LOW.**

---

## TB-2: Next.js ↔ Supabase

Auth: anon key (RLS applies) or service-role key (RLS bypassed). Transport: TLS.

### S/T — Spoofing & Tampering
- **T2.S.1 Service-role key exposure** — `SUPABASE_SERVICE_ROLE_KEY` is
  server-only (no `NEXT_PUBLIC_` prefix, `config.ts:16`); `getServiceSupabase`
  is documented SERVER ONLY (`server.ts:38-47`). Leak = full RLS bypass =
  CRITICAL. **Residual: depends on deploy-env hygiene (UNKNOWN — no env access).**
- **T2.T.1 Cross-tenant read via service-role path** — every service-role query
  carries an explicit workspace check: `resolveVaultSecret`/`resolveHermesBearerToken`
  compare `row.workspace_id === wid` (`hermes/chat/route.ts:97-106`;
  `hermes-proxy.ts:42-52`); OAuth callbacks verify seat-in-workspace before any
  service-role write (`google/callback/route.ts:91-97`,
  `microsoft/callback/route.ts:91-97`). These are **app-layer** checks, not RLS.
  A logic bug or a wrong `current_workspace_id()` return permits a cross-tenant
  read. **Residual: MEDIUM** — depends on RPC correctness (untested at runtime).

### I — Information Disclosure  (highest-value data here)
- **I-RLS / T2.I.1 `workspace_state` holds full workspace PII in one JSONB blob**
  — the entire `HermesState` (all candidate records: name, email, LinkedIn,
  GitHub, outreach history, classified replies) is persisted to one
  `workspace_state.state` column by the browser anon client
  (`workspace.ts:63-76`). Tenant isolation rests entirely on RLS.
  **Now there IS an RLS layer to assess:** migration
  `0005_rls_tenant_isolation.sql` (1) revokes anon/public on all tables (§1),
  (2) scopes every policy to `current_workspace_id()` (§4-11), (3) adds the
  missing `WITH CHECK` on `workspace_state` UPDATE to block workspace_id
  re-pointing (§6), (4) pins `profiles.role`/`workspace_id` against
  self-elevation and tenant-hop (§5). Supporting functions are SECURITY DEFINER
  with `set search_path = public` (`0001_init.sql:41-49,89`). **Design is sound
  on review.** **BUT it is UNVERIFIED against a live database** — no automated
  multi-tenant RLS test runs against real Postgres (the `rbac-keys` suite tests
  the app-layer `can()` matrix, not DB policies). Per audit rules, untested =
  not PASS. **Residual: LOW today / HIGH-until-proven at prod.** (RISK_REGISTER R2.)
- **T2.I.2 OAuth tokens & API secrets PLAINTEXT at rest** — `api_keys.secret` is
  `text not null` (`0003_api_keys.sql:14`); `email_connections.access_token` /
  `refresh_token` are plaintext text columns. `pgcrypto` is installed
  (`0001_init.sql:8`) **but is not used to encrypt these columns.** Column-level
  grants hide them from `authenticated`, but a DB dump, backup leak, or
  service-role compromise yields all provider keys and live mailbox tokens in
  cleartext. **Residual: HIGH at prod** — encrypt at rest (pgsodium/vault/app-layer
  envelope) or move to a dedicated secrets store. (RISK_REGISTER R5b.)

### D — Denial of Service
- **T2.D.1 Connection-pool exhaustion** — each invocation creates a fresh
  Supabase client; no pooler configured in code. Mitigated by Supabase's managed
  pooler at project level (UNVERIFIED — no project access). **Residual: MEDIUM at prod.**

---

## TB-3: Next.js ↔ Hermes/Aria Sidecar

Auth: server-resolved bearer (env `HERMES_API_KEY` or vault by id). Transport:
HTTP/HTTPS to private host.

### Spoofing / SSRF
- **T3.SSRF.1 SSRF allow-list** — upstream base URL is **env-only**, never
  client-supplied (`hermes/chat/route.ts:186-196`; `hermes-proxy.ts:23-30`), and
  passes `isAllowedHermesUrl` which blocks metadata/link-local/loopback-variants
  and allows only localhost + RFC-1918 + known service names (`api/url.ts:10-64`).
  Path is allow-listed (`HERMES_PROXY_ALLOW_LIST`, `hermes-proxy.ts:61-85`).
  Validated by `security-audit`/`hermes-proxy` tests (pass). **Residual: LOW.**
  *Note:* the allow-list intentionally permits only private hosts, so cloud LLM
  APIs are reachable only via the separate `provider !== "hermes"` branch with
  hard-coded provider endpoints (`ai/provider.ts`), not via SSRF. (RISK_REGISTER R5.)
- **T3.S.1 Sidecar impersonation on shared private net** — no mTLS/cert pinning;
  bearer token only. **Residual: LOW–MEDIUM** depending on network topology (UNKNOWN).

### Tampering
- **T3.T.1 Query-param injection upstream** — **mitigated**: only an explicit
  safe-param allowlist is relayed (`proxy/route.ts:97-100`). **Residual: LOW.**
- **T3.T.2 Response passthrough** — sidecar responses are streamed through
  unparsed (`proxy/route.ts:127-133`). Client uses `JSON.parse`, no `eval`.
  **Residual: LOW** (prototype-pollution theoretically nonzero).

### Information Disclosure / DoS
- **T3.I.1 Candidate PII reaches the sidecar** in outreach/classify prompts — a
  design constraint of live mode. **Residual: MEDIUM** (see TB-4 / DPA).
- **T3.D.1 Slow upstream holds serverless open** — 30 s `AbortSignal.timeout`
  (`hermes/chat/route.ts:68`, `hermes-proxy.ts:10`). 30 s is long for serverless;
  concurrent slow calls erode concurrency budget. **Residual: MEDIUM** — tighten.

---

## TB-4: Sidecar ↔ LLM Providers

### Information Disclosure
- **T4.I.1 PII to third-party processors / no DPA** — candidate PII is sent as
  prompt content to external providers. Under GDPR Art. 28 each provider is a
  processor; absent a DPA this is a compliance gap for EU candidates. **Not a
  code fix.** **Residual: MEDIUM (legal) — produce evidence for human review.**
- **T4.I.2 Provider key leakage via sidecar compromise** — standard operational
  residual. Keys resolved per-request, never logged/returned. **Residual: MEDIUM.**

### DoS
- **T4.D.1 Provider rate-limit blowback** — sidecar is expected to manage its own
  provider limits (outside this repo). **Residual: MEDIUM (UNKNOWN — external).**

---

## Cross-cutting issues (new this pass)

- **X-CSRF.1 OAuth seat-connection CSRF — no state nonce.** The Google/Microsoft
  mailbox-connect flows set `state = base64(JSON{seatId, provider})` with **no
  random, session-bound nonce** (`google/route.ts:31`, `microsoft/route.ts:31`)
  and the callbacks only decode it (`*/callback/route.ts:31-40`). There is no
  anti-CSRF token tying the callback to the initiating session. An attacker who
  completes their own provider authorization can craft a callback URL (their
  `code` + a victim `seatId` in `state`) and, if a logged-in admin loads it,
  bind the **attacker's mailbox tokens to a victim-workspace seat** — or a victim
  can be steered to connect their mailbox to an attacker-chosen seat. Partially
  contained by `requireAdmin` + seat-in-workspace checks on the callback, but the
  binding integrity gap is real. **Residual: MEDIUM** — add an HMAC/nonce state
  stored in an `HttpOnly` cookie and verified on callback. (RISK_REGISTER R-CSRF.)

- **X-RELAY.1 Demo-mode chat open-relay.** In `/api/hermes/chat`, when
  `supabaseEnabled === false` **and** `HERMES_API_URL` is unset, the auth block
  is skipped entirely (`route.ts:109-126`). If a cloud provider key is present in
  server env (`ANTHROPIC_API_KEY`, etc., `ai/provider.ts:111-116`), the
  `provider !== "hermes"` branch (`route.ts:152-184`) will call the paid provider
  **with no authentication and no rate limit** for any anonymous caller.
  **Residual: MEDIUM (conditional)** — require the `HERMES_PROXY_SECRET` (or
  disable the cloud branch) whenever any provider env key is set in demo mode.
  (RISK_REGISTER R-RELAY.)

- **X-SUPPLY.1 Vulnerable Next.js + non-blocking CI audit.** `npm audit`
  (run 2026-06-27) reports **4 high + 1 moderate** — Next.js advisories incl.
  **SSRF via WebSocket upgrades (GHSA-c4j6-fc7j-m34r)**, cache-poisoning, and
  App-Router XSS — plus a transitive `postcss` moderate. Installed `next@14.2.35`;
  npm's remediation is `next@16.2.9` (breaking). The CI audit step is
  **non-blocking** (`ci.yml:39-40` → `npm audit ... || true`), so this never
  fails a build. **Residual: HIGH** — pin to a patched Next.js line and make the
  high-severity audit gate blocking. (RISK_REGISTER R4 / R-NEXT.)

- **X-CONF.1 Header config drift.** `vercel.json` sets `Strict-Transport-Security`
  but `next.config.mjs` does not; `next.config.mjs` allows Google-Fonts/CloudFront
  sources that `vercel.json`'s CSP omits. Two divergent header sources risk an
  inconsistent prod posture depending on which layer wins. **Residual: LOW.**

- **X-DEMO.1 Hardcoded demo password fallback.** `DEMO_ADMIN_PASSWORD ??
  "admindemo123"` for `admin@hermes.local` (`auth/demo-login/route.ts:27,41`).
  Hard-disabled when `NODE_ENV==="production"` (`:15`). **Residual: LOW** — ensure
  prod build sets `NODE_ENV=production` (Vercel does) and the local default is
  never reused for a real account.

---

## Summary — Highest-Priority Threats (current tree)

| ID | Boundary | STRIDE / OWASP | Severity (today / prod) | Status |
|---|---|---|---|---|
| I-RLS / T2.I.1 | NJS↔Supabase | I / A01,A04 | LOW / **HIGH-until-proven** | RLS present, runtime-UNVERIFIED |
| T2.I.2 | NJS↔Supabase | I / A02 | LOW / **HIGH** | Plaintext secrets/tokens at rest |
| X-SUPPLY.1 | Build | A06 | **HIGH** / **HIGH** | 4 high deps; CI audit non-blocking |
| T1.S.2 / X-DEMO | Browser↔NJS | S / A07 | LOW / **HIGH** | Demo bypass shippable to prod |
| X-CSRF.1 | OAuth | CSRF / A01 | **MEDIUM** / MEDIUM | No OAuth state nonce |
| X-RELAY.1 | Browser↔NJS | A04,A07 | **MEDIUM** / MEDIUM | Demo chat open-relay (conditional) |
| T1.D.1 | Browser↔NJS | D / A04 | MEDIUM / **HIGH** | No rate limiting anywhere |
| T1.S.1 | Browser↔NJS | S / A03 | MEDIUM / MEDIUM | CSP `unsafe-inline`+`unsafe-eval` |
| T1.R.1 | Browser↔NJS | R | MEDIUM / MEDIUM | No tamper-evident audit |
| T4.I.1 | Sidecar↔LLM | I | MEDIUM / MEDIUM | No DPA (legal) |
| T3.D.1 / T2.D.1 | TB-3/TB-2 | D / A04 | MEDIUM / MEDIUM | Timeout long; no pooler verified |

**FIXED since v1:** T1.T.1 (send RBAC), T1.T.3 (byte cap), T3.T.1 (proxy params),
plus proxy admin-gate and chat per-task RBAC.

---

## Gate 2 verdict

**FAIL** for live-production readiness; the threat model itself is **complete and
current**. Rationale: open HIGH items remain — vulnerable Next.js dependencies
(X-SUPPLY.1), plaintext secrets/tokens at rest (T2.I.2), and **runtime-unverified
tenant isolation** (I-RLS) which, by the audit's untested=not-PASS rule, cannot be
certified without a live multi-tenant RLS test. Demo-mode posture (synthetic data,
no deploy) carries no live exposure today; the failing items are all "at prod."

See RISK_REGISTER.md for the full register with reproduction, evidence, fixes,
owners, and residual risk per item.
