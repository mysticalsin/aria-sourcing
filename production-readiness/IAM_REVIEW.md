# IAM Review — MSourcing (hermes-sourcing)

Phase 6 — Infrastructure / Network / IAM / TLS · **Sub-area: identity, keys, least-privilege, secrets handling, OAuth scopes, env separation**
Reviewer: Cloud / Network / IAM Engineer
Date: 2026-06-27
Scope: code + config review only. **No Vercel / Supabase / cloud console access authorized** — provider-side IAM marked UNKNOWN.
Repo: `/Users/tony/.../TEST/MSourcing` · branch `main` · working tree DIRTY.

---

## Executive summary

The **application-level** IAM is well-constructed for an MVP: a clear two-key Supabase model (public `anon` key gated by RLS; server-only `service_role` key that bypasses RLS only behind explicit workspace-id checks), a server-side `requireAdmin` guard on every key/connection/seat mutation (`src/lib/supabase/server.ts:18-36`), per-task RBAC on the Hermes proxy and outreach send, RLS with column-level grants that withhold `secret`/`access_token`/`refresh_token` from the `authenticated` role (`0003`, `0004`, `0005` migrations), and least-privilege OAuth **scopes** (Gmail `gmail.send` only; Graph `Mail.Send`, `User.Read`, `offline_access`).

The IAM **risks** are about secrets-at-rest and the un-reviewable provider plane: (1) all provider API keys and OAuth mailbox tokens are stored **in plaintext** in Postgres — protection rests entirely on the service-role/column-grant separation, with **no column encryption / KMS / Vault**; a DB dump or a service-role leak exposes every tenant's keys and live mailbox tokens (**HIGH**). (2) Microsoft OAuth seat-connect uses the **`/common` multi-tenant** endpoint, not single-tenant. (3) A **real Supabase service-role secret is sitting in the working-tree `.env.local`** (untracked/gitignored — good — but present), with unverified provenance and no rotation policy. (4) Provider-plane IAM — Vercel team roles / env-var access / deployment protection, Supabase key rotation, separate projects per environment, PITR — is entirely **UNKNOWN, blocked on access**.

**Gate 6 (IAM component): FAIL** — open HIGH (plaintext secrets at rest) plus UNKNOWN provider-plane IAM.

---

## Application IAM — verified strengths (evidence)

| Control | Evidence | Verdict |
|---|---|---|
| Two-key Supabase model; service-role server-only | `src/lib/supabase/config.ts:10-16` (no `NEXT_PUBLIC_` on service key), `server.ts:42-47` | PASS |
| `service_role` reads gated by workspace-id check | `hermes-proxy.ts:46-52`, `keys/test/route.ts:46-54`, `hermes/chat/route.ts:97-106`, `google/callback:91-97` | PASS |
| Admin guard on mutating routes | `requireAdmin` in `keys`, `keys/test`, `auth/google`, `auth/microsoft`, callbacks | PASS |
| Per-task RBAC | `hermes/chat:135-146`, `outreach/send:72-75`, `hermes/proxy:50-60` | PASS |
| RLS strips secret columns from `authenticated` | `0003:24-28`, `0004:24-28`, `0005:71-81` | PASS |
| No self-promotion / tenant-hop in profiles | `0005:129-150` (insert pins role='member'; update pins role+workspace) | PASS |
| Least-privilege OAuth scopes | `auth/google:37` (`gmail.send`), `auth/microsoft:37-40` (`Mail.Send`,`User.Read`,`offline_access`) | PASS |
| Email-domain allow-list enforced (not display-only) | `src/middleware.ts:45-53` | PASS |
| Demo-login hard-disabled in production | `auth/demo-login:15-17` (`NODE_ENV==='production'` → 404) | PASS |

---

## [HIGH] Provider API keys and OAuth mailbox tokens stored in plaintext at rest (no encryption / KMS)
- **Area / Affected:** `supabase/migrations/0003_api_keys.sql:14` (`secret text not null`); `0004_email_connections.sql:13-14` (`access_token text not null`, `refresh_token text`).
- **Description:** Both secret stores hold raw plaintext. The **only** protections are (a) RLS + a column-level grant that withholds these columns from the `authenticated` role, and (b) confining reads to the server-side service-role client. There is no application-level encryption, no pgsodium/`vault`, no envelope encryption with a KMS-held key. So the data is plaintext to anyone with: a Postgres dump/backup, a leaked `SUPABASE_SERVICE_ROLE_KEY`, a Supabase dashboard session, or any future RLS/grant regression.
- **Impact:** A single DB-dump or service-role-key compromise yields **every workspace's** third-party API keys (Resend/SendGrid/Anthropic/OpenAI/etc.) **and live Gmail/Graph OAuth access+refresh tokens** — i.e. the ability to send mail as connected mailboxes and to spend on connected LLM/email accounts. This is the highest-value secret store in the system and it is unencrypted.
- **Likelihood:** Medium — requires a secondary compromise (dump or service-role leak), but the service-role key is broadly used across routes and also currently present on a developer machine (see LOW finding below).
- **Reproduction:** Read migrations; columns are `text`, no crypto wrapper anywhere in `src/lib`.
- **Evidence:** `0003_api_keys.sql:14`; `0004_email_connections.sql:13-14`; no encryption helper in `src/lib` (grep).
- **Recommended fix:** Encrypt secrets at rest with envelope encryption (KMS-held data key, e.g. Supabase Vault / pgsodium, or app-side AES-GCM with the key in a secret manager — **not** in the same DB). Store only ciphertext + key id; decrypt server-side at point of use. Add OAuth-token rotation and revoke-on-disconnect. Restrict who/what can read backups.
- **Tests to add:** Test that a stored `secret`/token is never returned by any authenticated query and that the at-rest value is ciphertext.
- **Status:** OPEN · **Owner:** Tony · **Residual risk:** High until encrypted.

## [MEDIUM] Microsoft OAuth seat-connect uses the `/common` multi-tenant endpoint; OAuth `state` has no CSRF nonce
- **Area / Affected:** `src/app/auth/microsoft/route.ts:33` (`login.microsoftonline.com/common/oauth2/v2.0/authorize`); state construction `auth/microsoft:31`, `auth/google:31`.
- **Description:** The mailbox-connect flow targets `/common`, which accepts **any** Azure AD tenant and personal Microsoft accounts. For an internal recruiting tool this is broader than necessary — least-privilege favors the single-tenant authority (`login.microsoftonline.com/<tenant-id>`). Separately, the OAuth `state` parameter encodes only `{seatId, provider}` (base64url) with **no random nonce bound to the session** — it is not a CSRF token. (Note: the **app login** path is the Supabase Azure provider configured separately per `SUPABASE_SETUP.md:50-66`, where single-tenant is recommended; this finding is about the **seat mailbox-connect** routes.)
- **Impact:** Multi-tenant authority widens the trust surface for which identities can complete a mailbox connection. The missing nonce is a CSRF gap on the callback, **largely mitigated** because the callback re-checks `requireAdmin` against the live session (`google/callback:52-53`, and the seat workspace-ownership check at `:91-97`), so a forged callback cannot act without a valid admin session — but the `state` should still carry a bound nonce as defense-in-depth.
- **Likelihood:** Low/Medium.
- **Evidence:** `auth/microsoft/route.ts:33`; `auth/google/route.ts:31`; callback admin guard `auth/google/callback:52`.
- **Recommended fix:** Use the single-tenant authority for the seat-connect flow (or document why multi-tenant is required). Add a signed/random `state` nonce stored in an httpOnly cookie and verified on callback.
- **Tests to add:** Callback rejects a `state` with an unknown or missing nonce.
- **Status:** OPEN · **Owner:** Tony · **Residual risk:** Low/Medium.

## [LOW] Real Supabase service-role secret present in working-tree `.env.local`; provenance & rotation undefined
- **Area / Affected:** `.env.local` (untracked; **gitignored** — `.gitignore:26` `.env*.local`, confirmed `git check-ignore` and `git ls-files` shows only `.env.local.example` tracked).
- **Description:** `.env.local` exists on disk (644) with **non-empty** values for `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` (key **names** enumerated only — values were **not** read/printed; an attempt to redact-print was correctly blocked by the credential guard). It is not in git, so there is no repo leak. But a working service-role secret is sitting in plaintext on the dev machine. Whether it belongs to a **demo/scratch** project or a real one is **unverified**.
- **Impact:** If this is (or is ever pointed at) a production project, the most powerful Supabase credential is on a developer laptop with no rotation policy on record.
- **Likelihood:** Low (no repo exposure) but high blast radius if it is a prod key.
- **Evidence:** `git ls-files | grep env` → only `.env.local.example`; `git check-ignore -v .env.local` → ignored by `.gitignore:26`; key names present and non-empty.
- **Recommended fix:** Confirm the `.env.local` project is a throwaway demo project; if it is or ever was a real/shared project, **rotate** the service-role key. Document a key-rotation policy and keep service-role keys only in the platform secret store for deployed environments.
- **Status:** OPEN (process) · **Owner:** Tony · **Residual risk:** Low-to-High depending on provenance.

## [LOW] `DEMO_ADMIN_PASSWORD` falls back to a hardcoded default outside production
- **Area / Affected:** `src/app/api/auth/demo-login/route.ts:27` (`process.env.DEMO_ADMIN_PASSWORD ?? "admindemo123"`), account `admin@hermes.local`.
- **Description:** Demo login is correctly 404'd when `NODE_ENV==='production'` (`:15-17`). But any **non-production** deployment with Supabase enabled (e.g. a "staging" running `next start` with `NODE_ENV` not strictly `production`) accepts `admin`/`admin` and signs in as `admin@hermes.local` using the default password if the env var is unset.
- **Impact:** A reachable non-prod environment could be logged into as admin with known credentials.
- **Likelihood:** Low (requires a non-prod build to be internet-reachable).
- **Evidence:** `demo-login/route.ts:15-43`.
- **Recommended fix:** Require `DEMO_ADMIN_PASSWORD` to be set (no fallback) for the route to function, and additionally gate the route behind an explicit `ENABLE_DEMO_LOGIN` flag so it is off unless deliberately enabled.
- **Status:** OPEN · **Owner:** Tony · **Residual risk:** Low.

## [UNKNOWN — blocked on access] Provider-plane IAM (Vercel + Supabase + OAuth apps)
- **What cannot be verified from the repo:**
  - **Vercel:** team/member roles, who can read/modify environment variables, environment scoping (prod vs preview vs dev), deployment protection / password-protected previews, audit log, token scopes.
  - **Supabase:** separate projects per environment (dev/staging/prod) vs one shared project, service-role/anon key **rotation** history, JWT secret, project region (data residency — see `INFRASTRUCTURE_REVIEW.md`), network restrictions / IP allow-list, PITR/backups, dashboard MFA, who holds the service-role key.
  - **OAuth apps (Google/Microsoft):** single-tenant vs multi-tenant in the live registrations, admin-consent state, exact registered redirect URIs (vs the `localhost` defaults baked into the routes), client-secret rotation.
- **Access/decision needed:** read-only access to the Vercel project settings, the Supabase project settings, and the Google/Azure app registrations — or a written attestation from the owner of each.
- **Status:** UNKNOWN · **Owner:** Tony / platform.

---

## Gate decision (IAM component of Gate 6): **FAIL**
Open HIGH (plaintext secrets at rest) plus the entire provider-plane IAM being UNKNOWN. App-level IAM primitives are strong and should be preserved; the gate cannot PASS until secrets are encrypted at rest and the provider-plane IAM is evidenced.
