# Frontend Security Report — MSourcing ("hermes-sourcing")

**Phase 3 — Frontend Security** | Maps to: **Gate 3 (frontend-security part)**
**Auditor:** Frontend Security Engineer (production-readiness review)
**Date:** 2026-06-27
**Repo:** `/Users/tony/Library/CloudStorage/OneDrive-MantuGroup/Documents/TEST/MSourcing` — branch `main`, **working tree DIRTY** (audited the current on-disk tree as-is; ~50 modified files incl. `next.config.mjs`, `src/app/**`, `src/components/**`, `package.json`, `.github/workflows/ci.yml`, `.gitignore`). Findings reflect the dirty working tree, not the last commit.
**Stack audited:** Next.js 14.2.35 (App Router), React 18.3.1, TypeScript 5.6, Tailwind v3, three/r3f, recharts, framer-motion, @supabase/ssr 0.5.2.
**Baselines:** OWASP ASVS L2 (L3 for auth/PII), OWASP Top 10, OWASP API Top 10, NIST SSDF, WCAG 2.2 AA.

---

## 1. Executive Summary

The frontend has a **solid baseline**: no HTML-injection sinks (`dangerouslySetInnerHTML`/`innerHTML`/`eval`/`new Function` are absent from `src/` and asserted by an automated test), React auto-escaping covers rendered candidate/chat content, API-key *secrets* never reach client state (only a `last4` mask), the Supabase **service-role** key is correctly server-only (no `NEXT_PUBLIC_` prefix), external links carry `rel="noreferrer"`, an open-redirect guard (`safeRedirect`) is present, and no browser source maps are emitted. `npm run typecheck` is clean and all 87 security-relevant test assertions pass.

However the gate **cannot pass**. Two **HIGH** issues are open:

1. **CSP is materially weakened** — `script-src` ships `'unsafe-inline' 'unsafe-eval'` in production. For a console that renders candidate PII this negates most of the XSS containment the CSP is supposed to provide. (Carried forward and re-confirmed from prior `SECURITY_REVIEW.md` G-1; still present at `next.config.mjs:9`.)
2. **The pinned framework is outdated and carries multiple known CVEs** — `next@14.2.35` has open advisories including SSRF via WebSocket upgrades (CVSS 8.6), several DoS-via-Server-Components (7.5), and a middleware/proxy bypass (7.5). `npm audit` reports 4 HIGH + 1 MODERATE.

Plus several MEDIUM defense-in-depth gaps: plaintext candidate PII in `localStorage` (demo mode, no auth, no expiry), Supabase session tokens in **non-HttpOnly** cookies (XSS-exfiltratable, by design of the `@supabase/ssr` browser client), CSP/header **divergence** between `next.config.mjs` and `vercel.json` (HSTS only in the latter), and no URL-scheme validation on rendered candidate hrefs.

**Gate 3 (frontend-security part): FAIL** — open HIGH findings (F-1, F-2). No CRITICAL found in this area.

> Note on "demo/synthetic data": the app self-describes as MVP demo with synthetic data, which lowers *current* likelihood. Per audit rules I do not treat "it's only demo" as a mitigation for a production gate — several findings escalate the moment real candidate PII or a live Supabase project is wired in, so they are rated for the production posture, not the demo.

---

## 2. Scope & Method

Read-only review of: `next.config.mjs`, `vercel.json`, `src/middleware.ts`, `src/lib/store.ts` (localStorage persistence), `src/lib/supabase/{client,server,config}.ts`, `src/app/login/page.tsx`, `src/components/**` (href/link rendering), `src/lib/types.ts` (persisted shapes), API route auth (`src/app/api/{outreach/send,keys,intake,hermes/chat}/route.ts`), `.gitignore`/env files, and prior `production-readiness/SECURITY_REVIEW.md`.
Evidence commands run: `grep` (XSS sinks, `NEXT_PUBLIC_*`, localStorage, hrefs), `npm audit --json`, `npm run typecheck`, `npm run test:security`, `find .next -name '*.map'`, `git status`.

This report **supersedes the frontend-relevant portions** of `SECURITY_REVIEW.md` (its §G-1 CSP, §G-2 client role trust, and the headers row) with fresh evidence against the current tree; still-valid backend/RBAC content there is preserved and cross-referenced, not duplicated.

---

## 3. Gate Decision

| Check (frontend-security) | Status | Evidence |
|---|---|---|
| No XSS HTML-injection sinks (`dangerouslySetInnerHTML`/`innerHTML`/`eval`) | **PASS** | `grep -rn` over `src/` returns none; `tests/security-audit.mts:42-44` asserts and passes |
| Output encoding (React auto-escaping) for PII/chat | **PASS** | No raw-HTML render paths; all dynamic content via JSX text nodes |
| URL-scheme validation on user-controlled hrefs | **FAIL** | `candidate-drawer.tsx:283,300` render `githubUrl`/`linkedinUrl` with no scheme check (F-6) |
| CSP strength (no `unsafe-inline`/`unsafe-eval`) | **FAIL** | `next.config.mjs:9` `script-src 'self' 'unsafe-inline' 'unsafe-eval'` (F-1) |
| Security headers (XFO/nosniff/referrer/permissions/HSTS) present & consistent | **PARTIAL/FAIL** | XFO+nosniff+referrer+permissions present in both; HSTS only in `vercel.json`; CSP diverges (F-3) |
| No sensitive data in localStorage | **FAIL** | candidate PII persisted plaintext (`store.ts:416`, `STORAGE_KEY` `hermes-sourcing:v1`) (F-4) |
| Token handling (session not JS-readable) | **FAIL** | `@supabase/ssr` browser client → non-HttpOnly session cookies (F-5) |
| Client-side secret exposure (`NEXT_PUBLIC_*`) | **PASS** | only `SUPABASE_URL`, anon key (designed-public), `ALLOWED_EMAIL_DOMAIN`; service-role server-only (`config.ts:15`) |
| API-key secret never in client | **PASS** | `store.ts:1981`; only `last4` stored (`types.ts:796-805`); `tests/security-audit.mts:52` |
| Source-map exposure | **PASS** | no `productionBrowserSourceMaps`; `find .next -name '*.map'` = 0 |
| Open-redirect guard | **PASS** | `login/page.tsx:17` `safeRedirect` blocks `//` and absolute |
| Tabnabbing (`rel` on `_blank`) | **PASS** | all `target="_blank"` carry `rel="noreferrer"`; `tests/security-audit.mts:72` enforces |
| CSRF defense on state-changing routes | **PARTIAL** | cookie auth + SameSite=Lax default; no explicit Origin/CSRF token (F-7) |
| Frontend dependency vulns | **FAIL** | `npm audit`: 4 high + 1 moderate; `next@14.2.35` CVEs (F-2) |
| No committed secrets / source secrets | **PASS** | `.env*.local` gitignored; `tests/security-audit.mts:47-49` (no priv keys/AWS/OpenAI) pass |

**VERDICT: FAIL** — open HIGH (F-1, F-2). Re-test after both are remediated; remaining MEDIUMs must be dispositioned (fix or formally ACCEPTED) before a production launch handling real PII.

---

## 4. Findings

## [HIGH] F-1 — Production CSP uses `'unsafe-inline'` + `'unsafe-eval'` in `script-src`
- **Area:** CSP / XSS containment
- **Affected:** `next.config.mjs:9` (`"script-src 'self' 'unsafe-inline' 'unsafe-eval'"`); duplicated in `vercel.json` headers CSP. Supersedes `SECURITY_REVIEW.md` §G-1.
- **Description:** The script CSP permits arbitrary inline scripts and runtime code evaluation. This is the single biggest XSS mitigation in a SPA-style console, and it is disabled. Any future injection (a new `dangerouslySetInnerHTML`, a vulnerable dep, a reflected param) executes unimpeded.
- **Impact:** If an XSS sink is ever introduced, the attacker runs arbitrary JS in a context that renders candidate PII and (see F-5) holds JS-readable Supabase session tokens → session theft, PII exfiltration, action-on-behalf.
- **Likelihood:** Low today (no current sink), but this is the control that exists *precisely* for the future case; rated on the protection it fails to provide.
- **Reproduction:** `curl -I` the deployed app (or read `next.config.mjs:9`) and observe `Content-Security-Policy: ... script-src 'self' 'unsafe-inline' 'unsafe-eval'`.
- **Evidence:** `next.config.mjs:5-22`; `vercel.json` CSP value. `'unsafe-eval'` is not required by Next.js 14 production builds (only dev HMR); `recharts`/`three`/`framer-motion` do not require it at runtime.
- **Recommended fix:** Move to a **nonce-based** CSP (Next 14 `middleware` nonce + `experimental`/per-request header, or a CSP middleware) and drop `'unsafe-eval'` entirely; drop `'unsafe-inline'` for scripts (keep it only for `style-src` if Tailwind/framer inline styles require it, or move to nonces/hashes). At minimum, gate `'unsafe-eval'` to `NODE_ENV !== 'production'`.
- **Tests to add:** Header assertion test that production CSP `script-src` contains neither `'unsafe-eval'` nor `'unsafe-inline'` (extend `tests/security-audit.mts`).
- **Status:** OPEN
- **Owner:** Frontend / Platform
- **Residual risk after fix:** Low — style-src inline may remain (acceptable, lower risk).

## [HIGH] F-2 — Outdated `next@14.2.35` with multiple known CVEs (dep vulns affecting the frontend/framework)
- **Area:** Dependency vulnerabilities (frontend framework)
- **Affected:** `package.json` `next ^14.2.35` (installed 14.2.35), plus transitive `postcss`, `glob`, `eslint-config-next`.
- **Description:** `npm audit` reports **4 high + 1 moderate**. The `next` package carries open advisories including: SSRF in apps using WebSocket upgrades **CVSS 8.6** (GHSA-c4j6-fc7j-m34r), HTTP request deserialization DoS **7.5** (GHSA-h25m-26qc-wcjf), DoS with Server Components **7.5** (GHSA-q4gf-8mx6-v5v3, GHSA-8h8q-6873-q5fj), middleware/proxy bypass via i18n **7.5** (GHSA-36qx-fr4f-26g5), plus moderate XSS advisories for App-Router CSP-nonce and `beforeInteractive` scripts. `postcss <8.5.10` has a moderate XSS-in-stringify advisory (GHSA-qx2v-qp2m-jg93); `glob` 10.x has a command-injection advisory (build/dev tooling).
- **Impact:** Framework-level DoS / SSRF / middleware-bypass exposure on the deployed app; the i18n middleware-bypass and SSRF are directly relevant to an app that gates routes in `middleware.ts` and proxies to Hermes.
- **Likelihood:** Medium — these are published CVEs against the exact pinned version.
- **Reproduction:** `npm audit` → 5 vulns; `node -e "require('next/package.json').version"` → `14.2.35`.
- **Evidence:** `npm audit --json` (run 2026-06-27): `{moderate:1, high:4, total:5}`; advisory list above with CVSS scores and GHSA URLs.
- **Recommended fix:** Upgrade Next.js to a current patched release on a supported line. `npm audit` reports the fix as `next@16.x` (a **major** upgrade with breaking changes — App Router migration testing required); if a major jump is not yet feasible, move to the latest patched 14.2.x/15.x that closes the high-severity advisories and re-audit. Wire `npm audit --audit-level=high` as **blocking** in CI (currently non-blocking per task brief).
- **Tests to add:** CI gate `npm audit --omit=dev --audit-level=high` blocking; renovate/dependabot for `next`.
- **Status:** OPEN
- **Owner:** Platform / Frontend
- **Residual risk after fix:** Low if on a patched line + CI audit gate.

## [MEDIUM] F-3 — Security-header & CSP divergence between `next.config.mjs` and `vercel.json` (HSTS missing on non-Vercel path)
- **Area:** Security headers / configuration drift
- **Affected:** `next.config.mjs:5-31` vs `vercel.json` `headers`.
- **Description:** Two independent header definitions exist with **different** CSPs and header sets. `next.config.mjs` CSP allows `media-src ... cloudfront.net`, `style-src ... fonts.googleapis.com db.onlinewebfonts.com`, `font-src ... fonts.gstatic.com db.onlinewebfonts.com` and local Supabase; `vercel.json` CSP omits all of those and is generally tighter. **HSTS (`Strict-Transport-Security`) is present only in `vercel.json`** — a `next start` / self-host / non-Vercel deploy ships **no HSTS**. On Vercel both header sources can apply, producing duplicate/intersecting `Content-Security-Policy` headers; browsers enforce the **intersection**, so the login-hero CloudFront video / Google fonts could be blocked by the stricter `vercel.json` policy, and it is non-obvious which policy is actually in force.
- **Impact:** Ambiguous effective security posture; HSTS absent off-Vercel (downgrade/MITM exposure); potential silent functional breakage of fonts/video; maintenance hazard (changes made in one file, not the other).
- **Likelihood:** Medium (config drift is already present in the working tree).
- **Reproduction:** Diff the two CSP strings; deploy to a non-Vercel target and `curl -I` → no `Strict-Transport-Security`.
- **Evidence:** `next.config.mjs:9-19` vs `vercel.json` CSP value; HSTS only at `vercel.json` `Strict-Transport-Security`.
- **Recommended fix:** Single source of truth. Generate headers in `next.config.mjs` only (Next applies them on every deploy target) and remove the `headers` block from `vercel.json` (or vice-versa); add HSTS to whichever source is canonical. Add a test asserting both files agree (or that only one defines headers).
- **Tests to add:** Assert canonical header set incl. HSTS; assert no second CSP source.
- **Status:** OPEN
- **Owner:** Platform
- **Residual risk after fix:** Low.

## [MEDIUM] F-4 — Candidate PII persisted in plaintext `localStorage` (demo mode: no auth, no expiry, no encryption)
- **Area:** Sensitive data in client storage
- **Affected:** `src/lib/store.ts:416` (`window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))`), key `hermes-sourcing:v1` (`store.ts:100`); state includes `Candidate` PII (`types.ts`: `name`, `email`, `linkedinUrl`, `githubUrl`, `location`, `outreachHistory`, `replyHistory`).
- **Description:** In DEMO mode (no Supabase env) the **entire** Hermes workspace — candidate PII, recruiter outreach/reply messages — is written to `localStorage` in cleartext. DEMO mode also disables the auth gate (`middleware.ts:13` returns `NextResponse.next()` when `!supabaseEnabled`). So on any shared/kiosk/demo machine, all of that data is readable by anyone with browser access, persists indefinitely (no TTL/clear-on-logout), and is exposed to any same-origin script (compounded by F-1/F-5).
- **Impact:** PII disclosure if real candidate data is ever entered in demo mode or the demo is run on a shared device. Currently synthetic data lowers impact, but the *pattern* is unsafe and there is no guard preventing real data entry in demo mode.
- **Likelihood:** Medium (demo is the default no-config mode; easy to point at real data).
- **Reproduction:** Run with no Supabase env, add a candidate, open DevTools → Application → Local Storage → `hermes-sourcing:v1` → full plaintext PII.
- **Evidence:** `store.ts:345,372,416`; `middleware.ts:13`; `Candidate` fields in `types.ts`.
- **Recommended fix:** Treat demo mode as synthetic-only by contract and surface a persistent banner; do not persist PII-bearing fields to `localStorage` (or use session-scoped storage cleared on tab close); for any real-data path require LIVE/Supabase mode. Document that demo mode must never receive real PII.
- **Tests to add:** Assert demo persistence excludes/obfuscates PII fields, or assert a real-data guard.
- **Status:** OPEN
- **Owner:** Frontend
- **Residual risk after fix:** Low (synthetic-only demo).

## [MEDIUM] F-5 — Supabase session tokens stored in non-HttpOnly cookies (JS-readable → XSS-exfiltratable)
- **Area:** Token handling
- **Affected:** `src/lib/supabase/client.ts` (`createBrowserClient`), `src/lib/supabase/server.ts:55-72`, `src/middleware.ts:18-26` — cookie `options` passed through unchanged from `@supabase/ssr`.
- **Description:** `@supabase/ssr` stores the session (access + refresh JWT) in cookies that the **browser** client reads/writes; by design these are **not** `HttpOnly`. The code does not (and cannot, with this model) set `HttpOnly` on auth cookies. Combined with F-1 (weak CSP), any successful XSS can read `document.cookie` / the storage adapter and steal a live session/refresh token.
- **Impact:** Session/refresh-token theft → full account takeover in LIVE mode, if XSS occurs.
- **Likelihood:** Low-Medium (gated on an XSS foothold; F-1 raises the conditional probability).
- **Reproduction:** In LIVE mode, after login inspect cookies — Supabase auth cookies are present without `HttpOnly`; readable from console.
- **Evidence:** `client.ts` uses `createBrowserClient`; no `httpOnly` set anywhere; `grep` for `httpOnly` in `src/` returns nothing.
- **Recommended fix:** This is inherent to the `@supabase/ssr` browser-session model, so compensate: (a) close F-1 (nonce CSP, no `unsafe-inline/eval`) — primary mitigation; (b) ensure cookies are `Secure` + `SameSite=Lax/Strict` in production (verify, don't assume — see below); (c) keep refresh-token rotation on; (d) short access-token TTL. Document the accepted residual.
- **Tests to add:** Integration check asserting `Secure` + `SameSite` on auth cookies in a production-like config.
- **Status:** OPEN (mitigation-dependent)
- **Owner:** Frontend / Platform
- **Residual risk after fix (F-1 closed):** Low.

## [MEDIUM] F-6 — No URL-scheme validation on rendered candidate/booking hrefs (`javascript:`/`data:` DOM-XSS vector)
- **Area:** XSS via attacker-controlled URL
- **Affected:** `src/components/candidates/candidate-drawer.tsx:283` (`href={dc.githubUrl}`), `:300` (`href={dc.linkedinUrl}`); `src/components/calendar/booking-calendar.tsx:74,141,144` and `src/app/calendar/page.tsx:225,236` (`booking.teamsLink`/`calLink`).
- **Description:** These hrefs are rendered directly from data fields. React does **not** sanitize `javascript:`/`data:` URLs in `href` (it only logs a dev warning) — it still renders them. In DEMO mode the values are synthetic (`mock-ai.ts:691-692`), but in LIVE mode candidate `linkedinUrl`/`githubUrl` and booking links originate from external sources (sourcing platforms, calendar integrations) and are not validated against an allowed scheme. A crafted `javascript:...` URL becomes a one-click DOM-XSS.
- **Impact:** Stored/click-triggered XSS in the PII console (compounds F-1/F-5).
- **Likelihood:** Low-Medium (LIVE mode with externally-sourced candidate data).
- **Reproduction:** Set a candidate `linkedinUrl` to `javascript:alert(document.cookie)`; render the drawer; click the link.
- **Evidence:** `candidate-drawer.tsx:283,300`; no `new URL()`/scheme allowlist applied to these values (the existing `src/lib/api/url.ts` validator guards *server-side SSRF*, not client hrefs).
- **Recommended fix:** A small `safeHref(url)` helper that returns the URL only if `new URL(url).protocol` ∈ {`http:`,`https:`,`mailto:`} else `#`/undefined; apply to all data-driven hrefs.
- **Tests to add:** Unit test for `safeHref` rejecting `javascript:`/`data:`/`vbscript:`; lint/grep test that data-driven hrefs route through it.
- **Status:** OPEN
- **Owner:** Frontend
- **Residual risk after fix:** Low.

## [LOW] F-7 — No explicit CSRF token / Origin check on state-changing API routes (relies on SameSite default)
- **Area:** CSRF
- **Affected:** `src/app/api/outreach/send/route.ts:64-69`, `src/app/api/keys/route.ts:45`, `src/app/api/intake/route.ts:59-61`, `src/app/api/hermes/chat/route.ts:116-117` — all authenticate via `supabase.auth.getUser()` (cookie session) but perform no `Origin`/`Referer` validation and use no anti-CSRF token.
- **Description:** State-changing POST/DELETE rely solely on cookie-borne sessions. The only CSRF barrier is the cookie's `SameSite` attribute, which is the `@supabase/ssr` default (Lax) and **not verified** in this audit at runtime. `SameSite=Lax` blocks cross-site POST, so practical risk is limited, but there is no defense-in-depth Origin check and no test pinning the SameSite value.
- **Impact:** If a cookie were ever issued with `SameSite=None` (misconfig/regression), cross-site state-changing requests (send outreach, store/delete keys) become possible.
- **Likelihood:** Low.
- **Reproduction:** N/A statically; depends on runtime cookie attributes.
- **Evidence:** API routes show `getUser()` auth only; no `req.headers.get('origin')` checks; cookie options unmodified.
- **Recommended fix:** Add an `Origin`/`Sec-Fetch-Site` allowlist check to state-changing handlers; assert `SameSite=Lax|Strict` on auth cookies in a test.
- **Tests to add:** Reject cross-origin `Origin` on POST `/api/outreach/send`, `/api/keys`.
- **Status:** OPEN
- **Owner:** Frontend / Backend
- **Residual risk after fix:** Low.

## [LOW] F-8 — Third-party font CDN (`db.onlinewebfonts.com`) in CSP style/font allowlist (supply-chain / privacy)
- **Area:** Supply chain / privacy / CSP allowlist
- **Affected:** `next.config.mjs:11,13` — `style-src ... https://db.onlinewebfonts.com`, `font-src ... https://db.onlinewebfonts.com`.
- **Description:** The CSP explicitly trusts a non-Google third-party font CDN for stylesheets and fonts on the login hero. With `'unsafe-inline'` also allowed for styles, a compromised or hostile CDN response (CSS) can exfiltrate via background/font fetches and degrade the integrity guarantees. Also a privacy/data-residency consideration (third-party request from every login).
- **Impact:** Supply-chain exposure of the login surface; minor privacy leak.
- **Likelihood:** Low.
- **Evidence:** `next.config.mjs:11,13`.
- **Recommended fix:** Self-host the font (download + serve from `/public`, `font-src 'self'`); drop the CDN from CSP. Removes a third-party trust edge and a network round-trip.
- **Status:** OPEN
- **Owner:** Frontend
- **Residual risk after fix:** Negligible.

---

## 5. Verified-Good Controls (PASS evidence)

- **No HTML-injection sinks:** `grep -rn "dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|document.write"` over `src/` = none; `eval(`/`new Function(` = none. Asserted by `tests/security-audit.mts:42-44` (passing).
- **API-key secret isolation:** `store.ts:1981` comment + impl — only `id/name/provider/last4/status` stored client-side (`types.ts:796-805`); secret POSTed to `/api/keys` and held server-side. `tests/security-audit.mts:52` (api_keys select excludes secret) passes; `tests/rbac-keys.mts` 23/23 pass.
- **Service-role key server-only:** `config.ts:15` `SUPABASE_SERVICE_ROLE_KEY` has no `NEXT_PUBLIC_` prefix; only `getServiceSupabase()` (server) reads it.
- **Client-exposed env audit:** only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (RLS-protected anon key, designed-public), `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` (non-secret). `grep -rn NEXT_PUBLIC src/`.
- **No committed secrets:** `git ls-files | grep .env` → only `.env.local.example`; `.env.local`/`.env.production.example` are gitignored (`.gitignore`: `.env`, `.env*.local`). `tests/security-audit.mts:47-49` (no private/AWS/OpenAI keys in source) pass. CI runs gitleaks.
- **Source-map exposure:** no `productionBrowserSourceMaps` in `next.config.mjs`; `find .next -name '*.map'` = 0. Next 14 does not emit client maps in prod by default.
- **Open redirect:** `login/page.tsx:17` `safeRedirect` allows only `^/` and rejects `//` (protocol-relative) — open-redirect-safe.
- **Tabnabbing:** every `target="_blank"` carries `rel="noreferrer"` (candidate-drawer, calendar, booking-calendar); enforced by `tests/security-audit.mts:72`.
- **Clickjacking:** `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` in both config sources.
- **Other headers present:** `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `base-uri 'self'`, `form-action 'self'`.
- **API route authn:** `outreach/send`, `keys`, `intake`, `hermes/chat` all call `supabase.auth.getUser()` and 401 on no user (LIVE mode). (Note: authz/role enforcement on some routes is a backend concern carried in `SECURITY_REVIEW.md` §G-2 — referenced, not re-owned here.)
- **Build/test health:** `npm run typecheck` clean; `npm run test:security` → security-audit 15/15, security-redos 9/9, rbac-keys 23/23, api-validation 17/17, guardrails 11/11, linkedin-policy 12/12 (87 assertions, 0 failures).

---

## 6. Dependencies snapshot (`npm audit`, 2026-06-27)

| Package | Severity | Notable advisory | Fix |
|---|---|---|---|
| `next` 14.2.35 | HIGH | SSRF via WebSocket upgrades (8.6), DoS Server Components (7.5 ×2), middleware/proxy bypass i18n (7.5) | upgrade (audit suggests `next@16.x`, major) |
| `postcss` <8.5.10 | MODERATE | XSS via unescaped `</style>` in stringify (6.1) | via next upgrade |
| `glob` 10.2.0–10.4.5 | HIGH | CLI command injection (7.5, build/dev tooling) | via eslint-config-next upgrade |
| `@next/eslint-plugin-next` / `eslint-config-next` | HIGH | bundled with vulnerable range | `eslint-config-next@16.x` |

Totals: **moderate 1, high 4, critical 0**. CI currently runs `npm audit` **non-blocking** — recommend making `--audit-level=high` blocking (ref F-2).

---

## 7. Open Items / Blockers (need decision or access)

- **Runtime cookie attributes (F-5, F-7):** `Secure`/`SameSite`/`HttpOnly` on the live Supabase auth cookies cannot be confirmed statically (set by `@supabase/ssr` at runtime; no live project authorized). **UNKNOWN — blocked on:** a LIVE Supabase env to capture `Set-Cookie` headers, or a documented decision pinning the cookie policy + a test.
- **Effective CSP on Vercel (F-3):** which of the two CSP sources actually serves (and whether they duplicate) needs a deployed-target `curl -I`. **Blocked on:** a Vercel preview deploy (no cloud access authorized for this audit).
- **Supabase RLS posture:** the public anon key is only safe if Row-Level Security is enforced (backend/data-layer concern). Frontend PASS for "anon key is designed-public" is **contingent** on RLS being on — verify in the data-layer phase.

---

## 8. Changelog vs prior `SECURITY_REVIEW.md`

- **G-1 (unsafe-eval, High)** → re-confirmed against current `next.config.mjs:9`, broadened to cover `'unsafe-inline'` and the `vercel.json` duplicate → **F-1**.
- **G-2 (client role trust, Medium)** → backend/authz; preserved in `SECURITY_REVIEW.md`, referenced not re-owned.
- **New since prior review:** F-2 (Next CVEs — audit re-run), F-3 (config divergence — new `vercel.json`/`next.config.mjs` drift in dirty tree), F-4 (localStorage PII), F-5 (non-HttpOnly tokens), F-6 (href scheme validation), F-7 (CSRF defense-in-depth), F-8 (third-party font CDN).
