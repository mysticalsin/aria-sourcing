# API Security Report — Hermes Sourcing (MSourcing)

**Phase 4 — API security (OWASP API Security Top 10).**
**Gate mapped:** Gate 4 — API.
**Date:** 2026-06-27
**Reviewer:** API Security Engineer (production-readiness review)
**Method:** Static analysis of the `main` working tree (DIRTY — see note), plus read-only command evidence (`npm run test:security`, `npm audit`, greps). No running instance, no live Supabase/Hermes, no network calls except the npm registry.
**Baselines:** OWASP API Security Top 10 (2023), OWASP Top 10, OWASP ASVS L2/L3 (auth + multi-tenant + sensitive data), NIST SSDF, CIS Controls.

> **Working-tree note (REQUIRED):** The repo is a git repo on branch `main` with a **dirty working tree**. `git status` shows 4 of the 8 API route files modified and not committed: `src/app/api/intake/route.ts`, `src/app/api/keys/route.ts`, `src/app/api/keys/test/route.ts`, `src/app/api/outreach/send/route.ts` (plus `next.config.mjs`, `.github/workflows/ci.yml`, `vercel.json` is tracked, etc.). **This report audits the current uncommitted tree as-is.** Several controls present in the working tree are newer than the prior `SECURITY_REVIEW.md` (dated the same day) and **supersede** some of its findings — flagged inline below.

---

## Executive Summary

The API surface is small (8 `route.ts` handlers + 6 `/auth/*` OAuth handlers) and shows real, above-average security engineering for an MVP: server-side secret resolution (secrets never returned to the browser), an env-only upstream URL with an SSRF allow-list, an explicit Hermes path allow-list, per-task RBAC on operational routes, a workspace cross-tenant guard on OAuth writes, Zod body validation with byte caps measured against actual bytes (not the spoofable `Content-Length`), upstream timeouts, and a structurally safe "never auto-send" outreach path. The `test:security` suite passes (87 assertions across 6 suites).

**However, Gate 4 — API is FAIL.** The blockers:

1. **HIGH — Hermes proxy is an unauthenticated open relay in demo mode.** `/api/hermes/proxy` puts its *entire* auth/RBAC block inside `if (supabaseEnabled)`. In demo mode (no Supabase) it performs **no authentication at all**, yet still attaches the server's `HERMES_API_KEY` and relays to `HERMES_API_URL` (covering `api/config`, `api/memory`, `api/files`, `api/sessions`, `v1/chat/completions`, …). The sibling `/api/hermes/chat` route explicitly closes this exact hole with a `HERMES_PROXY_SECRET` check; the proxy route does not. The shipped `.env.local.example` defaults to `HERMES_API_URL=http://127.0.0.1:8642` with an empty Supabase URL — i.e. the vulnerable combination is the *default* example config.
2. **HIGH — No API-level rate limiting (API4:2023 Unrestricted Resource Consumption).** Zero throttling on any handler. LLM cost-amplification via `/api/hermes/chat` + `/api/hermes/proxy → v1/chat/completions`, and an unauthenticated-in-demo `/api/intake` compute endpoint, are abusable in a tight loop.
3. **HIGH — Exploitable framework dependency.** `next@14.2.35` carries 4 HIGH advisories (middleware/redirect cache-poisoning, SSRF via WebSocket upgrades, 2× DoS) + a moderate postcss XSS; the only fix is `next@16` (breaking). CI runs `npm audit ... || true` (non-blocking), so this never gates a deploy.

Secondary issues: OAuth seat-connect flow has no anti-CSRF state nonce / PKCE; session cookie flags are not asserted by the app (UNKNOWN — relies on `@supabase/ssr` defaults); divergent/duplicated security headers between `next.config.mjs` and `vercel.json` (HSTS only in the latter); intake "webhook" has no signature/replay protection and a cookie-session auth model incompatible with server-to-server callers; several config/upstream errors return HTTP 200 with `{ok:false}` (broken error semantics); no OpenAPI contract / API versioning.

**Superseded prior findings (now FIXED in the dirty tree):** SECURITY_REVIEW.md **G-2** (operational routes lacked role checks) and **G-3** (blanket query-param forwarding on the proxy) are resolved in the current code — evidence below.

---

## Gate 4 — API: **FAIL**

| Required check (this area) | Result | Evidence |
|---|---|---|
| Authn enforced on every state-changing endpoint | **FAIL** | `/api/hermes/proxy` has no authn in demo mode (`route.ts:38` wraps all auth in `if (supabaseEnabled)`); env example ships the triggering config |
| Per-endpoint authorization (RBAC) | **PASS** | `outreach/send:72-75`, `hermes/chat:135-146`, `hermes/proxy:50-60`, `keys*` `requireAdmin` — verified; supersedes prior G-2 |
| Rate limiting / brute-force / abuse controls | **FAIL** | No throttle anywhere (`grep` shows only business-level email caps, no HTTP rate limiting / 429 / Upstash) |
| Session/token security (expiry/rotation/revocation/cookie flags) | **UNKNOWN** | App never sets cookie flags; relies on `@supabase/ssr` defaults — not verifiable without live Supabase Set-Cookie inspection |
| SSRF allow-list correctness (Hermes proxy) | **PASS (with residual)** | `url.ts` env-only base URL + host allow-list; `hermes-proxy.ts:61-85` path allow-list; query-param allow-list `proxy/route.ts:97` — supersedes prior G-3 |
| Webhooks: signature + replay protection | **FAIL** | `/api/intake` is the inbound email "webhook"; no HMAC/signature/timestamp verification (`grep` finds none) |
| Error consistency / correct status codes | **FAIL** | Config/upstream failures return HTTP 200 + `{ok:false}` (e.g. `hermes/chat:159,190,195`; `proxy:84`) |
| OpenAPI accuracy (or note absent) | **N/A — ABSENT** | No OpenAPI/Swagger spec in repo (only the `vercel.json` `$schema`) |
| Versioning / idempotency / pagination | **PASS (partial)** | Outreach de-dupe via `claim_and_record` (idempotent); own routes unversioned, no idempotency keys (LOW) |
| Exploitable dependencies in the API stack | **FAIL** | `npm audit`: 4 HIGH (Next.js) + 1 moderate; CI audit non-blocking |

**Decision: FAIL** — multiple OPEN HIGH findings (open relay in demo, no rate limiting, exploitable Next.js) and one UNKNOWN (cookie flags). Per the conservative rule, unknown/untested = not PASS.

---

## Endpoint Inventory & Authn/Authz Matrix

Middleware does **not** run on `/api/*` (matcher excludes `api` — `middleware.ts:67`), so every API route enforces its own auth. This is good defense-in-depth (no reliance on the historically CVE-prone Next.js middleware for API auth) but means each handler must be individually correct.

| Method · Path | Authn | Authz | Demo-mode behavior | Notes |
|---|---|---|---|---|
| `POST /api/auth/demo-login` | none (creds in body) | n/a | works; **disabled when `NODE_ENV=production`** (`route.ts:15`) | dev-only; hardcoded fallback pw (F-13) |
| `GET /api/health` | **none (public)** | n/a | open | leaks Node version + config booleans (F-11) |
| `POST /api/intake` | session **only if `supabaseEnabled`** (`route.ts:57-62`) | none | **OPEN/unauth** | "webhook" with no signature (F-08) |
| `POST /api/keys` | `getUser` + `requireAdmin` (`route.ts:40`) | admin | bypassed (returns demo metadata) | secret never returned ✓ |
| `DELETE /api/keys` | `requireAdmin` (`route.ts:70`) | admin | bypassed | uuid-validated id ✓ |
| `POST /api/keys/test` | `requireAdmin` (`route.ts:43`) | admin + workspace match (`:54`) | simulated | service-role read, no secret returned ✓ |
| `POST /api/outreach/send` | `getUser` (`route.ts:67`) | `can(role,"outreach")` (`:72-75`) | **always dry-run** (`:50-57`) | From = seat, never body ✓; supersedes G-2 |
| `POST /api/hermes/chat` | `getUser`, **or `HERMES_PROXY_SECRET` if demo+Hermes** (`route.ts:112-126`) | per-task `can()` (`:135-146`) | guarded relay | server-defined system prompt ✓ |
| `GET/POST/PUT/PATCH/DELETE /api/hermes/proxy` | **`getUser` ONLY if `supabaseEnabled`** (`route.ts:38`) | admin for mutating paths (`:50-60`) | **OPEN relay** ⚠ | **F-01 — no demo guard, unlike chat** |
| `GET /api/auth/callback` | exchanges OAuth code | n/a | n/a | open-redirect guarded (`:11`) ✓ |
| `GET /api/auth/signout` | n/a | n/a | n/a | GET-triggered signout (CSRF-able logout, low) |
| `GET /api/auth/{google,microsoft}` | `requireAdmin` (`:16`) | admin | n/a | **no PKCE / no state nonce** (F-04) |
| `GET /api/auth/{google,microsoft}/callback` | `requireAdmin` (`:52`) + workspace guard (`:94-97`) | admin | n/a | stores OAuth tokens plaintext (see SECURITY_REVIEW G-5) |

---

## Findings

## [HIGH] F-01 — Hermes proxy is an unauthenticated open relay in demo mode
- **Area:** OWASP API1/API2/API8 (BOLA/Broken Auth/Security Misconfig) · Hermes proxy SSRF allow-list scope
- **Affected:** `src/app/api/hermes/proxy/route.ts:37-61` (all auth inside `if (supabaseEnabled)`), `src/lib/api/hermes-proxy.ts:32-55` (`resolveHermesBearerToken` falls back to `process.env.HERMES_API_KEY`), `.env.local.example:9,42` (Supabase empty, `HERMES_API_URL` set by default).
- **Description:** The proxy's authentication and admin-mutation gate are entirely inside `if (supabaseEnabled) { … }`. When Supabase is not configured (demo mode), the handler skips straight to query validation → path allow-list → env base URL → bearer resolution (which returns the server's `HERMES_API_KEY`) → upstream `fetch`. So **any anonymous caller** can drive the proxy against the configured `HERMES_API_URL` with the server's own credentials, reaching every allow-listed path: `api/config`, `api/memory`, `api/files`, `api/skills`, `api/tools`, `api/models`, `api/sessions`, `api/oauth/account`, and `v1/chat/completions`.
- **Impact:** Unauthenticated read of Aria runtime config/memory/files (sensitive-data exposure), unauthenticated session creation, and unauthenticated LLM inference at the deployer's cost. The sibling `/api/hermes/chat` route explicitly mitigates this exact scenario with a `HERMES_PROXY_SECRET` shared-secret check (`chat/route.ts:118-126`); the proxy route omits the equivalent guard — an inconsistency, not a deliberate design.
- **Likelihood:** Medium–High. Conditional on `!supabaseEnabled && HERMES_API_URL set`, but **that is exactly the shipped `.env.local.example` default** (Supabase blank, `HERMES_API_URL=http://127.0.0.1:8642`). Anyone copying the example into a hosted demo is exposed.
- **Reproduction:** With no `NEXT_PUBLIC_SUPABASE_URL` and a reachable `HERMES_API_URL`, `curl -X POST 'https://<host>/api/hermes/proxy?upstreamPath=api/config'` with no auth → relays upstream config. `…?upstreamPath=v1/chat/completions` with a JSON body → free inference.
- **Evidence:** `route.ts:38` (`if (supabaseEnabled)`); `hermes-proxy.ts:33` (`let bearerToken = process.env.HERMES_API_KEY ?? ""`); `.env.local.example:42`.
- **Recommended fix:** Mirror the chat route — when `!supabaseEnabled && process.env.HERMES_API_URL`, require `Authorization: Bearer ${HERMES_PROXY_SECRET}` (503 if unset, 401 if mismatched) before any upstream call. Better: refuse to relay at all unless authenticated.
- **Tests to add:** Unit test asserting `/api/hermes/proxy` returns 401/503 in demo mode without the proxy secret; integration test that mutating paths still require admin in live mode.
- **Status:** OPEN · **Owner:** Backend/API · **Residual risk:** High until the demo guard is added; the default example config triggers it.

## [HIGH] F-02 — No API-level rate limiting (Unrestricted Resource Consumption)
- **Area:** OWASP API4:2023 · OWASP A04 · CIS Controls (DoS/abuse)
- **Affected:** all handlers — notably `src/app/api/hermes/chat/route.ts`, `src/app/api/hermes/proxy/route.ts`, `src/app/api/intake/route.ts`, `src/app/api/keys/test/route.ts`.
- **Description:** There is no per-IP/per-user request throttling anywhere. `grep -niE "rate.?limit|throttle|429|upstash"` finds only **business-level** email/LinkedIn daily caps (`settings.rateLimits`, `claim_and_record`) — not HTTP request rate limiting. The byte-cap in `validateBody` limits payload size, not request frequency.
- **Impact:** (a) LLM cost-amplification: a loop on `/api/hermes/chat` (cloud providers) or `/api/hermes/proxy?upstreamPath=v1/chat/completions` runs up provider bills; (b) DoS on `/api/intake`, which is unauthenticated in demo and runs the `parseEmailAndJD` parser on up to 64 KB of attacker text per call; (c) no brute-force ceiling on the application's own endpoints. Serverless auto-scale converts this into an unbounded cost/availability event.
- **Likelihood:** High (no control present).
- **Reproduction:** `for i in $(seq 1 10000); do curl -s -X POST https://<host>/api/intake -d '{"email":"…64KB…"}'; done` — no 429, every request does work.
- **Evidence:** `grep` output (no `429`/`throttle`/`ratelimit` in `src/`); `validate.ts:18-25` caps bytes only.
- **Recommended fix:** Add a sliding-window limiter keyed by Supabase user id (authed) / IP (anon) — e.g. Upstash Redis or Vercel rate limiting — at minimum on `hermes/*`, `intake`, `keys/test`, `auth/demo-login`. Return 429 with `Retry-After`.
- **Tests to add:** Limiter unit test (allow N, block N+1, window reset); 429 shape assertion.
- **Status:** OPEN · **Owner:** Platform/API · **Residual risk:** High. (Prior SECURITY_REVIEW G-6 rated this Medium; escalated to HIGH for cost-amplification + unauthenticated intake.)

## [HIGH] F-03 — Exploitable framework dependency (Next.js 14.2.35) + non-blocking CI audit
- **Area:** OWASP A06 (Vulnerable Components) · NIST SSDF PW.4/RV
- **Affected:** `package.json` (`next ^14.2.35`, installed 14.2.35), `.github/workflows/ci.yml:39-40`.
- **Description:** `npm audit` reports **5 vulnerabilities (4 HIGH, 1 moderate)**, all via Next.js / its bundled postcss: middleware-redirect cache poisoning (`GHSA-3g8h-86w9-wvmq`), **SSRF via WebSocket upgrades** (`GHSA-c4j6-fc7j-m34r`), DoS in Server Components (`GHSA-8h8q-6873-q5fj`), DoS in the Image Optimization API (`GHSA-h64f-5h5j-jqjh`), App-Router CSP-nonce XSS (`GHSA-ffhc-5mcf-pf4q`), plus postcss `</style>` XSS. The audit's `fix available` is `next@16.2.9` — a breaking major. The CI step runs `npm audit --audit-level=high || true`, so it **never fails the build**. (Note: the older middleware-auth-bypass CVE-2025-29927 is already patched at ≥14.2.25, so that specific bypass is not present.)
- **Impact:** Framework-level SSRF, cache-poisoning, and DoS directly affecting the routes/middleware this report covers; the CSP-nonce XSS is moot today (no nonce in use — F-06) but becomes relevant if nonces are adopted.
- **Likelihood:** Medium (public advisories, unauthenticated vectors for several).
- **Reproduction:** `npm audit --audit-level=high` → 4 high; `npm audit --json` metadata `{moderate:1, high:4}`.
- **Evidence:** command output captured 2026-06-27; `ci.yml:40` (`|| true`).
- **Recommended fix:** Plan the `next@16` upgrade (or apply backported patches if staying on 14.x via a maintained release); make the CI audit blocking at `--audit-level=high` for production releases, or gate on a reviewed allow-list.
- **Tests to add:** CI assertion that `npm audit --audit-level=high` exits 0 (post-upgrade); smoke test of middleware/image routes after upgrade.
- **Status:** OPEN · **Owner:** Platform · **Residual risk:** High until upgraded; partly mitigated for APIs because API routes re-check auth in-handler (don't rely on middleware).

## [MEDIUM] F-04 — OAuth seat-connect flow lacks anti-CSRF state nonce and PKCE
- **Area:** OWASP API8 (Security Misconfig) · ASVS V3/V51 (OAuth)
- **Affected:** `src/app/auth/google/route.ts:31`, `src/app/auth/microsoft/route.ts:31` (`state = base64url(JSON.stringify({seatId, provider}))`); callbacks `src/app/auth/google/callback/route.ts:31-36` and `microsoft/callback/route.ts:31-36` (decode but do not verify against a session-bound value).
- **Description:** The `state` parameter carries only `{seatId, provider}` — there is **no random, session-bound nonce**, and the callback never compares `state` to anything stored server-side. The authorization-code flow uses a client secret server-side but **no PKCE**.
- **Impact:** OAuth login-CSRF / mailbox-injection: an attacker who completes their own consent and then induces a logged-in admin to hit the callback could bind the attacker's tokens to a workspace seat (later outreach sent from / replies readable via the attacker's mailbox). Impact is **limited** by `requireAdmin` on the callback plus the workspace cross-tenant guard (`callback:94-97`), which prevent cross-tenant seat targeting — but the missing nonce still removes the standard CSRF defense for the flow.
- **Likelihood:** Low–Medium (requires an authenticated admin to follow a crafted link).
- **Reproduction:** Capture a valid `code`+`state` from an attacker-initiated flow; deliver the callback URL to an admin session. With no nonce check, the binding proceeds.
- **Evidence:** `google/route.ts:31` (no nonce in state); `callback:31-40` (decodes, validates only `seatId`).
- **Recommended fix:** Generate a CSRF nonce, store it in an httpOnly cookie at flow start, embed it in `state`, and verify equality in the callback (then clear it). Add PKCE (`code_challenge`/`code_verifier`).
- **Tests to add:** Callback rejects mismatched/absent state nonce; PKCE verifier round-trip test.
- **Status:** OPEN · **Owner:** Auth · **Residual risk:** Low after fix.

## [MEDIUM] F-05 — Session cookie flags not asserted by the app (token theft surface)
- **Area:** OWASP API2 (Broken Auth) · ASVS V3 (Session Management)
- **Affected:** `src/lib/supabase/server.ts:53-72`, `src/middleware.ts:17-28`, `src/app/api/auth/demo-login/route.ts:29-38` — all pass cookies straight through to `@supabase/ssr` without specifying `httpOnly`, `secure`, or `sameSite`.
- **Description:** The app never sets cookie security flags; it relies entirely on `@supabase/ssr` defaults. `@supabase/ssr` stores the access/refresh tokens in cookies that the browser Supabase client also reads, so they are typically **not `httpOnly`** (JS-readable). This could not be verified statically without a live Set-Cookie response.
- **Impact:** If tokens are JS-readable, any XSS yields full session takeover — and the XSS bar is lowered by the `unsafe-inline`/`unsafe-eval` CSP (F-06). Expiry/rotation/revocation are Supabase-project settings not visible in this repo.
- **Likelihood:** Unknown (depends on runtime flags + presence of an XSS sink).
- **Reproduction:** Inspect `Set-Cookie` on a live login: confirm `HttpOnly; Secure; SameSite` on `sb-*-auth-token`. (Not performed — no live Supabase authorized.)
- **Evidence:** no `httpOnly`/`secure`/`sameSite` literals in `src/` cookie code (grep); `server.ts:53-72`.
- **Recommended fix:** Pin cookie options where the SDK allows (`secure: true`, `sameSite: "lax"`, shortest viable lifetime). Document and verify the runtime `Set-Cookie` flags as a release-gate check. Confirm Supabase JWT expiry/refresh-rotation/revocation-on-signout settings.
- **Tests to add:** Release-gate script that curls login and asserts cookie flags; signout-revokes-session integration test.
- **Status:** UNKNOWN (blocked on live Supabase Set-Cookie inspection) · **Owner:** Auth · **Residual risk:** Medium until verified.

## [MEDIUM] F-06 — CSP allows `unsafe-inline` + `unsafe-eval` (XSS amplifier on a PII console)
- **Area:** OWASP A03/A05 · security headers (cross-refs SECURITY_REVIEW G-1, which rates it High)
- **Affected:** `next.config.mjs:13` and `vercel.json:11` — `script-src 'self' 'unsafe-inline' 'unsafe-eval'`.
- **Description:** Both header sources keep `unsafe-inline` and `unsafe-eval` in `script-src`, which neuters most CSP XSS mitigation. Listed here (rather than only in the headers phase) because it directly amplifies the session-cookie token-theft path in F-05 on a console rendering candidate PII.
- **Impact:** A single reflected/stored XSS becomes script execution + (likely) session exfiltration.
- **Likelihood:** Medium.
- **Evidence:** `next.config.mjs:13`; `vercel.json:11`.
- **Recommended fix:** Move to nonce-based CSP (drop `unsafe-inline`); restrict `unsafe-eval` to `NODE_ENV==='development'` only.
- **Tests to add:** Header-assertion test that production CSP contains no `unsafe-eval`.
- **Status:** OPEN (tracked in SECURITY_REVIEW G-1) · **Owner:** Frontend/Platform · **Residual risk:** Medium–High.

## [MEDIUM] F-07 — Divergent & duplicated security headers (next.config.mjs vs vercel.json)
- **Area:** OWASP A05 (Security Misconfig) · CIS Benchmarks (HTTP headers)
- **Affected:** `next.config.mjs:8-39` and `vercel.json:5-35`.
- **Description:** Both files independently define CSP + the other security headers with **different values**. `vercel.json` sets `Strict-Transport-Security` (HSTS) and a minimal CSP; `next.config.mjs` omits HSTS but allows extra `font-src`/`style-src`/`media-src` origins (Google Fonts, onlinewebfonts, CloudFront) and the local Supabase origins. On Vercel both header sets are applied, which can emit **two `Content-Security-Policy` headers** (browsers enforce both → the more restrictive `vercel.json` CSP may break fonts/video, or vice-versa). On non-Vercel `next start`, only `next.config.mjs` applies → **no HSTS at all**.
- **Impact:** Unpredictable/over- or under-restrictive policy depending on deploy target; missing HSTS on self-hosted; maintenance hazard (two sources of truth drift).
- **Likelihood:** Medium (deploy-target dependent).
- **Evidence:** side-by-side CSP strings differ; `vercel.json:30-33` has HSTS, `next.config.mjs` does not.
- **Recommended fix:** Single source of truth. Generate headers in `next.config.mjs` (works on every target) including HSTS, and remove the `vercel.json` `headers` block (or vice-versa). Reconcile the CSP allow-lists.
- **Tests to add:** Snapshot test of the response headers from a built app; assert exactly one CSP header and HSTS present.
- **Status:** OPEN · **Owner:** Platform · **Residual risk:** Medium.

## [MEDIUM] F-08 — Inbound intake "webhook" has no signature/replay protection; auth model unfit for server-to-server
- **Area:** OWASP API8 · webhook signature/replay (this phase's explicit scope)
- **Affected:** `src/app/api/intake/route.ts:38-63`.
- **Description:** The route is documented as the target for a Microsoft Graph subscription / n8n / Zapier inbound-email integration (a webhook), but it has **no HMAC signature verification, no timestamp/nonce replay window, and no shared-secret header**. Its only auth is a **Supabase session cookie** when `supabaseEnabled` — which a server-to-server webhook caller cannot present. So the endpoint is either (a) **fully open/unauthenticated in demo mode**, or (b) effectively unusable by its intended automated callers in live mode (they have no browser session).
- **Impact:** In demo: anonymous abuse / DoS (compounds F-02). In live: either it stays open (if the integration bypasses the gate via service auth not present here) or the integration is broken. No integrity/authenticity guarantee on inbound JD emails that seed campaigns.
- **Likelihood:** Medium.
- **Evidence:** `intake/route.ts:57-63` (cookie session only); no signature logic anywhere (grep).
- **Recommended fix:** Add a webhook auth scheme: verify an HMAC signature over the raw body with a per-source secret, enforce a timestamp window + nonce cache for replay, and accept that scheme *in addition to* (or instead of) the cookie session. Rate-limit (F-02).
- **Tests to add:** Reject missing/invalid signature; reject stale timestamp; reject replayed nonce.
- **Status:** OPEN · **Owner:** Integrations/API · **Residual risk:** Medium.

## [MEDIUM] F-09 — Inconsistent error semantics: config/upstream failures return HTTP 200
- **Area:** OWASP API8 · error handling / status-code correctness (this phase's scope)
- **Affected:** `src/app/api/hermes/chat/route.ts:159,171,176,182,190,195,267,273`; `src/app/api/hermes/proxy/route.ts:84`.
- **Description:** Numerous failure paths return `NextResponse.json({ ok:false, reason })` **with no status argument → HTTP 200**. Examples: "No API key configured" (200), "Upstream error N" (200), "Empty response" (200), "Aria runtime URL rejected" (200, an SSRF-policy block), proxy `getHermesBaseUrl` failure (200). This is partly intentional (client falls back to the mock), but it conflates success and failure at the transport layer.
- **Impact:** Monitoring/alerting and clients keying on HTTP status see 200 for genuine errors (incl. an SSRF-policy denial); harder incident detection; inconsistent with the routes' own 401/403/413 usage.
- **Likelihood:** N/A (correctness defect, always present).
- **Evidence:** cited lines return objects without a `{ status }` second arg.
- **Recommended fix:** Use accurate codes (`502` upstream, `503`/`500` config, `403` policy block) while keeping `{ok:false}` so the client can still fall back; or document a single envelope convention and assert it in tests.
- **Tests to add:** Status-code assertions per failure branch.
- **Status:** OPEN · **Owner:** API · **Residual risk:** Low (defense/operability).

## [LOW] F-10 — No OpenAPI contract; routes unversioned; no idempotency keys
- **Area:** OWASP API9 (Improper Inventory) · versioning/idempotency/pagination
- **Affected:** repo-wide (no `openapi.*`/`swagger` file — only `vercel.json` `$schema`); all `route.ts`.
- **Description:** No machine-readable API contract exists, so consumers and scanners have no inventory. Own routes carry no version prefix; mutations like `POST /api/keys` have no idempotency key (a retried request can create duplicate key rows). Pagination is only forwarded to upstream Hermes (`proxy:97` `page/limit/cursor`); own routes expose no list endpoints. Outreach send is idempotent via `claim_and_record` de-dupe (good).
- **Impact:** Inventory/onboarding/testing gap; minor duplicate-write risk.
- **Evidence:** `grep -i openapi|swagger` → only `vercel.json`.
- **Recommended fix:** Publish an OpenAPI 3.1 spec (can be generated from the Zod schemas via `zod-to-openapi`); add a version prefix or header; accept an `Idempotency-Key` on key creation.
- **Status:** OPEN · **Owner:** API · **Residual risk:** Low.

## [LOW] F-11 — `/api/health` discloses runtime details unauthenticated
- **Area:** OWASP A05 (info disclosure)
- **Affected:** `src/app/api/health/route.ts:14-21`.
- **Description:** Public health probe returns `node: process.version` plus config booleans (`supabaseConfigured`, `hermesConfigured`, `emailDomainRestricted`). Useful for an attacker fingerprinting the Node version (ties to dep-CVE targeting) and confirming whether the live backend is wired.
- **Impact:** Minor reconnaissance aid.
- **Evidence:** `health/route.ts:18` returns `process.version`.
- **Recommended fix:** Return only `{ ok: true }` publicly; gate the detailed object behind auth or an internal-only path.
- **Status:** OPEN · **Owner:** Platform · **Residual risk:** Low.

## [LOW] F-12 — `X-Powered-By: Next.js` not disabled
- **Area:** OWASP A05 (info disclosure) · CIS hardening
- **Affected:** `next.config.mjs` (no `poweredByHeader: false`).
- **Description:** Next.js emits `X-Powered-By: Next.js` by default; not disabled in config. Confirms the framework (and broadly its version family) to anyone.
- **Recommended fix:** Set `poweredByHeader: false` in `next.config.mjs`.
- **Status:** OPEN · **Owner:** Platform · **Residual risk:** Low.

## [LOW] F-13 — Dev demo-login hardcoded fallback password
- **Area:** OWASP API2 / secret handling
- **Affected:** `src/app/api/auth/demo-login/route.ts:23,27` (`admin/admin` → `DEMO_ADMIN_PASSWORD ?? "admindemo123"`).
- **Description:** The dev one-click login maps `admin/admin` to a real Supabase account using a hardcoded fallback password when `DEMO_ADMIN_PASSWORD` is unset. **Disabled in production** via `NODE_ENV==='production'` (`:15`).
- **Impact:** Low — only reachable outside production. Risk is if a non-prod env with real-ish data runs with the default `admin@hermes.local` password.
- **Recommended fix:** Require `DEMO_ADMIN_PASSWORD` to be set (no literal fallback); fail closed if absent.
- **Status:** ACCEPTED (dev-only, prod-disabled) — recommend removing the literal fallback · **Owner:** Auth · **Residual risk:** Low.

## [LOW] F-14 — All access control bypassed in demo mode (deploy-config hazard)
- **Area:** OWASP A05 · (prior SECURITY_REVIEW G-7)
- **Affected:** `src/lib/supabase/server.ts:21-23` (`requireAdmin` returns `{ok:true}` when `!supabaseEnabled`), plus every route's `if (supabaseEnabled)` auth guard.
- **Description:** When Supabase env is absent, all authn/authz is intentionally skipped for the localStorage demo. Documented and by design — but any production/staging deploy that *accidentally* ships without `NEXT_PUBLIC_SUPABASE_URL` silently runs with **no access control** (and, per F-01, an open Hermes relay).
- **Recommended fix:** Add a startup assertion / release-gate check that fails the build/boot if a "production" deploy lacks Supabase env; log a loud warning whenever `requireAdmin` is bypassed.
- **Status:** OPEN (deploy-gate) · **Owner:** Platform · **Residual risk:** Low–Medium depending on deploy discipline.

---

## Controls Verified Present (evidence)

- **Secrets never returned to the browser** — `keys/route.ts:57` returns `{id, last4}`; `keys/test` returns `{valid, detail}`; bearer tokens set as headers server-side, never in bodies (`hermes-proxy.ts`, `hermes/chat:200-205`). `rbac-keys.mts` last4-masking tests pass.
- **Env-only upstream URL + SSRF allow-list** — `hermes/chat:187` and `hermes-proxy.ts:24` read `process.env.HERMES_API_URL`; `isAllowedHermesUrl` (`url.ts`) blocks metadata/link-local/loopback-except-127.0.0.1 and allow-lists only local/private hosts. No client-supplied URL is ever forwarded. **Supersedes prior G-3** for URL handling.
- **Hermes path allow-list** — `hermes-proxy.ts:61-85`; `hermes-proxy.mts` tests pass (blocks `../etc/passwd`, arbitrary paths, empty path).
- **Query-param allow-list on proxy (NEW)** — `proxy/route.ts:97` forwards only `page/limit/cursor/q/level`. **Supersedes prior SECURITY_REVIEW G-3** (blanket `forEach` forwarding is gone).
- **Per-task / per-route RBAC on operational routes (NEW)** — `outreach/send:72-75` (`can(role,"outreach")`), `hermes/chat:135-146` (per-task `outreach`/`source`), `hermes/proxy:50-60` (admin for non-allow-listed POST + all PUT/PATCH/DELETE). **Supersedes prior SECURITY_REVIEW G-2** (which said only `/api/keys` checked roles).
- **`getUser()` not `getSession()`** — every server auth check uses `auth.getUser()` (validates with the auth server) — `middleware.ts:32`, all routes. Good (avoids trusting an unverified local JWT).
- **Body validation + true byte cap** — `validate.ts:18-25` measures actual received bytes (not spoofable `Content-Length`); `api-validation.mts` (17) passes.
- **Workspace cross-tenant guard before service-role writes** — OAuth callbacks `:91-97`; `keys/test:54`; `resolveVaultSecret`/`resolveHermesBearerToken` verify `workspace_id === current_workspace_id`.
- **Upstream timeouts** — `AbortSignal.timeout(30_000)` on all upstream fetches; payload cap `1 MiB` on proxy (`proxy:107`).
- **Open-redirect guard** — `auth/callback/route.ts:11` rejects absolute/protocol-relative redirects.
- **Never-auto-send invariant** — `outreach/send` degrades to dry-run unless every guardrail holds; `guardrails.mts` (11) + `linkedin-policy.mts` (12) pass.
- **CSRF posture on JSON APIs** — state-changing routes accept `application/json` (forces CORS preflight) with SameSite cookies, giving baseline CSRF resistance for the JSON endpoints (the GET-triggered OAuth/signout flows are the exception — F-04, and CSRF-logout is low-impact).

**Test evidence:** `npm run test:security` → `security-audit 15/0`, `security-redos 9/0`, `rbac-keys 23/0`, `api-validation 17/0`, `guardrails 11/0`, `linkedin-policy 12/0` (all pass). `npm audit` → 4 HIGH + 1 moderate (F-03).

---

## Status vs Prior SECURITY_REVIEW.md (delta)

| Prior finding | Prior sev | Current status (dirty tree) | Evidence |
|---|---|---|---|
| G-1 `unsafe-eval` in CSP | High | **OPEN** (kept; this report F-06) | `next.config.mjs:13` |
| G-2 client-side role trust on operational routes | Medium | **FIXED** — server RBAC added | `outreach/send:72`, `hermes/chat:143`, `hermes/proxy:55` |
| G-3 blanket query-param forwarding to Hermes | Low | **FIXED** — explicit param allow-list | `proxy/route.ts:97` |
| G-6 no API rate limiting | Medium | **OPEN — escalated to HIGH** (F-02) | grep: no throttle |
| G-7 demo-mode bypasses requireAdmin | Low | **OPEN** (F-14) | `server.ts:21` |
| (new) proxy unauth in demo | — | **OPEN (HIGH, F-01)** | `proxy/route.ts:38` |
| (new) Next.js HIGH advisories | — | **OPEN (HIGH, F-03)** | `npm audit` |
| (new) OAuth state nonce/PKCE | — | **OPEN (MEDIUM, F-04)** | `auth/google/route.ts:31` |

---

## Blockers to clear Gate 4 — API (PASS criteria)

1. **F-01** — add the demo-mode auth guard to `/api/hermes/proxy` (HIGH).
2. **F-02** — implement API rate limiting on `hermes/*`, `intake`, `keys/test`, `auth/demo-login` (HIGH).
3. **F-03** — remediate Next.js HIGH advisories and make the CI audit blocking for releases (HIGH).
4. **F-05** — verify session cookie flags on a live deployment (resolve the UNKNOWN).
5. Recommended before launch: F-04, F-07, F-08, F-09.

Gate flips to **PASS** only once F-01/F-02/F-03 are FIXED with evidence and F-05 is verified (not left UNKNOWN).
