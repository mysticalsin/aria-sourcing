# TLS & Security Headers Report — MSourcing (hermes-sourcing)

> SUPERSEDED by `STATUS.md` 2026-07-10 for current release posture. Historical 2026-06-27 evidence may contain stale stack versions, suite counts, migration ranges, and verdicts.


Phase 6 — Infrastructure / Network / IAM / TLS · **Sub-area: TLS / HTTPS / HSTS / security headers**
Reviewer: Cloud / Network / IAM Engineer
Date: 2026-06-27
Scope: configuration review only. **No live scan access authorized** — every live-exposure claim is marked UNKNOWN.
Repo: `/Users/tony/Library/CloudStorage/OneDrive-MantuGroup/Documents/TEST/MSourcing` · branch `main` · **working tree DIRTY** (audited as-is).

---

## Executive summary

Two header sources exist and **diverge**: `next.config.mjs:8-39` (applied by the Next runtime) and `vercel.json:5-35` (applied at the Vercel edge). Both ship a CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, and `Permissions-Policy`. **HSTS exists only in `vercel.json`** (`max-age=63072000; includeSubDomains; preload`), so a self-hosted Node deployment (a path the project explicitly documents — `.env.production.example:5`, `DEPLOYMENT.md:57`) ships **no HSTS at all**. The two CSPs are not identical (different `style-src`, `font-src`, `media-src`, `connect-src`), and when both layers emit a `Content-Security-Policy` header the resulting browser behavior (duplicate vs. override, most-restrictive-wins) is **environment-dependent and unverified**. Both CSPs use `'unsafe-inline'` **and** `'unsafe-eval'` in `script-src`, which removes most of CSP's XSS value on a console that renders candidate PII. Live TLS posture (protocol versions, cipher suites, certificate, actual HTTP→HTTPS redirect, whether HSTS is really served, custom-domain DNS/CAA) is **UNKNOWN — blocked on live access**.

**Gate 6 (TLS/Headers sub-component): FAIL** — header config drift + `unsafe-inline`/`unsafe-eval` are open MEDIUM issues; live TLS posture is UNKNOWN. No CRITICAL here, but not releasable as-is.

---

## What is verified (evidence)

| Control | Source | Verdict |
|---|---|---|
| CSP present | `next.config.mjs:10-31`, `vercel.json:10-12` | PRESENT (but divergent) |
| `X-Frame-Options: DENY` | `next.config.mjs:32`, `vercel.json:13-16` | PASS |
| `frame-ancestors 'none'` | `next.config.mjs:23`, `vercel.json:11` | PASS (clickjacking defense, both layers) |
| `X-Content-Type-Options: nosniff` | `next.config.mjs:33`, `vercel.json:17-20` | PASS |
| `Referrer-Policy: strict-origin-when-cross-origin` | `next.config.mjs:34`, `vercel.json:21-24` | PASS |
| `Permissions-Policy: camera=(), microphone=(), geolocation=()` | `next.config.mjs:35`, `vercel.json:25-28` | PASS |
| `base-uri 'self'` / `form-action 'self'` | `next.config.mjs:24-25`, `vercel.json:11` | PASS |
| HSTS | `vercel.json:29-32` only | PARTIAL (Vercel only; absent in `next.config.mjs` / self-hosted) |
| Live TLS (version/ciphers/cert/redirect) | — | UNKNOWN (no scan access) |

---

## [MEDIUM] CSP & security-header drift between `next.config.mjs` and `vercel.json`; HSTS only on one path
- **Area / Affected:** `next.config.mjs:8-39` vs `vercel.json:5-35`
- **Description:** Two independent header definitions exist for overlapping paths (`/:path*` vs `/(.*)`). They are not equivalent:
  - `next.config.mjs` CSP allows `style-src … https://fonts.googleapis.com https://db.onlinewebfonts.com`, `font-src … https://fonts.gstatic.com https://db.onlinewebfonts.com`, `media-src 'self' blob: https://d8j0ntlcm91z4.cloudfront.net` (login hero video), and `connect-src` includes Supabase **plus** local dev origins (`http://127.0.0.1:54321`, `ws://localhost:54321`).
  - `vercel.json` CSP has **no** `media-src` (CloudFront login video falls back to `default-src 'self'` → blocked), **no** Google Fonts in `style-src`/`font-src`, and a narrower `connect-src`.
  - **HSTS is present only in `vercel.json`** (`next.config.mjs` has none).
- **Impact:** (1) When both layers send a `Content-Security-Policy`, the effective policy is ambiguous and unverified — browsers may apply both (intersection / most-restrictive) or one may override, breaking the login hero or, worse, silently weakening policy. (2) A self-hosted Node deploy (documented at `DEPLOYMENT.md:57`, `.env.production.example:5`) gets **no HSTS** → first-request SSL-strip / downgrade exposure for a PII console. (3) Drift means security changes can be made in one file and silently not take effect.
- **Likelihood:** High that drift causes either a functional break (CSP) or a missing control (HSTS on self-hosted), depending on deploy target.
- **Reproduction:** Diff the two CSP strings; confirm `media-src`/HSTS present in only one. Cannot confirm live precedence without a deployed instance (`curl -I https://<host>`), which is **blocked on access**.
- **Evidence:** `next.config.mjs:10-35`; `vercel.json:10-32`.
- **Recommended fix:** Make **one** source of truth for security headers (prefer `next.config.mjs` `headers()` so it travels with every deploy target, including self-hosted), add HSTS there, and delete the duplicate header block from `vercel.json` (keep `vercel.json` only for `regions`/build). Re-derive the single CSP so it includes exactly the origins actually used (Supabase, CloudFront media if still used, Google Fonts if still used) and nothing dev-only.
- **Tests to add:** A header-assertion test that fetches a built route and asserts exactly one `Content-Security-Policy` and one `Strict-Transport-Security` with the expected directives (extend `tests/security-audit.mts`).
- **Status:** OPEN · **Owner:** Tony · **Residual risk:** Medium until consolidated and verified live.

## [MEDIUM] CSP `script-src` uses `'unsafe-inline'` and `'unsafe-eval'`
- **Area / Affected:** `next.config.mjs:12`; `vercel.json:11`
- **Description:** Both CSPs set `script-src 'self' 'unsafe-inline' 'unsafe-eval'`. `'unsafe-inline'` permits arbitrary inline `<script>`; `'unsafe-eval'` permits `eval`/`Function`. Together they remove almost all of CSP's reflected/stored-XSS mitigation.
- **Impact:** On a console rendering candidate PII and recruiter messages, an injected script (e.g. via an unsanitized field rendered to the DOM) executes unimpeded. CSP becomes cosmetic for script.
- **Likelihood:** Medium — depends on an XSS sink existing elsewhere; CSP is the defense-in-depth layer that is currently disabled.
- **Reproduction:** Inspect directive; confirm both unsafe tokens present.
- **Evidence:** `next.config.mjs:12`, `vercel.json:11`.
- **Recommended fix:** Adopt Next.js **nonce-based CSP** via middleware (`'strict-dynamic'` + per-request nonce), drop `'unsafe-inline'`. `'unsafe-eval'` is sometimes pulled in by `three`/wasm/dev tooling — confirm whether production bundles actually require it; if not, remove it. If a true blocker exists, document it as an accepted risk with the specific dependency named. Cross-ref `FRONTEND_SECURITY_REPORT.md`.
- **Tests to add:** CSP-directive assertion test that fails if `'unsafe-inline'` reappears in `script-src`.
- **Status:** OPEN · **Owner:** Tony · **Residual risk:** Medium (defense-in-depth gap).

## [LOW] `X-Powered-By: Next.js` not suppressed
- **Area / Affected:** `next.config.mjs` (no `poweredByHeader: false`)
- **Description:** `poweredByHeader` is not set, so Next emits `X-Powered-By: Next.js`, disclosing the framework (and aiding version fingerprinting alongside the known dependency advisories — see `NETWORK_SECURITY_REPORT.md`).
- **Impact:** Minor recon aid for an attacker.
- **Evidence:** `grep poweredByHeader next.config.mjs` → 0 matches.
- **Recommended fix:** Add `poweredByHeader: false` to `next.config.mjs`.
- **Status:** OPEN · **Owner:** Tony · **Residual risk:** Low.

## [LOW] Production CSP `connect-src` carries local dev origins
- **Area / Affected:** `next.config.mjs:22`
- **Description:** The single `connect-src` shipped to all environments includes `http://127.0.0.1:54321`, `ws://127.0.0.1:54321`, `http://localhost:54321`, `ws://localhost:54321` (local Supabase). These are harmless in prod (only the user's own loopback) but are env-separation noise and broaden the policy unnecessarily.
- **Impact:** Negligible direct risk; poor hygiene / clarity.
- **Evidence:** `next.config.mjs:22`.
- **Recommended fix:** Gate dev origins behind `process.env.NODE_ENV !== 'production'` when building the CSP string.
- **Status:** OPEN · **Owner:** Tony · **Residual risk:** Low.

## [UNKNOWN — blocked on access] Live TLS posture, HSTS delivery, redirect, DNS/CAA
- **Area / Affected:** Deployed host (Vercel `*.vercel.app` and/or custom domain) — no live access.
- **What cannot be verified from the repo:** TLS protocol versions (TLS 1.2/1.3 only?), cipher suites, certificate issuer/expiry/chain, OCSP stapling, whether HTTP→HTTPS redirect actually occurs, whether the HSTS header is actually served (and whether `preload` was really submitted — submitting commits the apex+subdomains and is hard to reverse), custom-domain DNS records, and a CAA record restricting issuance.
- **Access/decision needed:** (a) the production hostname(s); (b) authorization to run an external TLS scan (e.g. `testssl.sh` / SSL Labs) and `curl -sI`; (c) confirmation of whether `preload` was submitted to the HSTS preload list.
- **Recommended fix (once access granted):** Verify TLS 1.2+ only, modern ciphers, valid cert with auto-renew, enforced HTTPS redirect, HSTS served on every response, and a CAA record. Vercel manages certs automatically for verified domains, but auto-management is **not** evidence of correct configuration.
- **Status:** UNKNOWN · **Owner:** Tony / platform · **Residual risk:** Unknown until scanned.

---

## Gate decision (TLS/Headers component of Gate 6): **FAIL**
Open MEDIUM findings (header drift + HSTS-on-one-path; `unsafe-inline`/`unsafe-eval`) and UNKNOWN live TLS posture. No PASS without consolidating headers, removing unsafe CSP tokens (or documenting a named blocker), and a live TLS scan.
