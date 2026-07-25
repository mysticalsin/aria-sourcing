# Enterprise-Readiness Audit — ARIA / MSourcing

Method: 6 evidence-only finders (input trust · rate limits · DB scale · auth flows · secrets/env/SSL · ops)
→ 47 raw findings → adversarial refutation per finding → **35 confirmed real**. Full agent journal:
workflow wf_69c619b9-4c7. Every line below is file:line-cited. Credit-card/payment testing removed from
scope per owner.

## TL;DR

ARIA is **not** starting from zero on your checklist — most of it is already built and hardened. A real
rate limiter guards 47/54 API routes; input validation is centralized and streaming-bounded; secrets are
clean (gitleaks over full history, AES-256-GCM envelope encryption, no keys in tracked files); backups,
pagination, and hot-path indexes exist. The gaps are **real but bounded**: three that bite at 10× scale
(the JSONB monolith and its O(N) triggers), the auth-lifecycle features a multi-user rollout needs
(email verification, password reset, MFA — all SMTP-gated), gateway-level login throttling, and the ops
surface (error monitoring, proven restore, dead-job alerting). Nothing here is a rewrite.

## Scoreboard

| Dimension | Status | One-line verdict |
|---|---|---|
| Input trust / validation | **SOLID** | Central `validate.ts` streams+caps+zod on all body routes; 4 injection gaps at the edges |
| Rate limiting / bot | **PARTIAL** | App limiter covers 47/54 routes + DB quotas; but per-instance, no Kong throttle, no CAPTCHA |
| DB scalability | **GAP** | Indexes/pagination good; the workspace_state JSONB monolith + O(N) triggers are the 10× breaker |
| Auth flows | **PARTIAL** | Login/session/logout/domain-gate solid; email-verify OFF, no reset flow, no MFA (all SMTP-gated) |
| Secrets / env / SSL | **SOLID** | Clean tracked tree, envelope encryption, HTTPS forced; minor: cookie Secure flag, service-key `server-only` |
| Operations | **GAP** | Backups exist but restore never proven; zero error monitoring; new job spine has no alerting |

## Already covered — do NOT rebuild

- **Rate limiting exists**: `src/lib/rate-limit.ts` — dependency-free sliding window, spoof-resistant IP key
  (last XFF hop, never leftmost), on 47/54 routes with real caps (hermes/chat 60/min, source 10/min, enrich
  15/min, demo-login 5/min *before* password check). Plus **durable DB quotas**: apollo 100 ws/25 user per
  day, `sourcing_run_quota` FOR UPDATE, per-seat daily caps + warmup ramp in the claim RPCs.
- **Input validation exists**: `src/lib/api/validate.ts` streams the body, cancels the reader at maxBytes,
  safe-parses, zod-validates — 50 call sites, every schema length/enum/array-capped.
- **Secrets are clean**: gitleaks 8.30.1 over `--all` history in CI; no keys in tracked files; AES-256-GCM
  envelope encryption (DATA_ENCRYPTION_KEY, 8-key rotation) for provider keys at rest; NEXT_PUBLIC surface
  is only URL/anon-key/flags.
- **Backups exist**: `scripts/backup.sh` (self-verifying pg_dump into scratch DB, table-inventory + RLS +
  ledger + schema-fingerprint gated) + `restore-drill.sh`; Fly volume snapshots (14-day retention); deploy
  HARD-GATES on a validated volume-recovery receipt.
- **Indexes + pagination exist**: partial indexes match every hot queue query (dispatch, review, recovery,
  the new 0038 job queue); `list_workspace_candidates` LIMIT-clamped 100; `list_loop_events` true keyset.
- **Auth core exists**: SSR cookie sessions, forced single cookie name, middleware getUser() refresh,
  fail-closed 503 without Supabase, signup disabled, allowed-domain gate (pages + API), open-redirect guards.
- **HTTPS**: force_https on app + Kong; HSTS on the Next app.

---

## CONFIRMED GAPS — code-fixable now (no owner accounts/secrets/DNS needed)

### Critical
- **C1 — workspace_state JSONB monolith (10× breaker).** Every candidate/outreach/reply/activity for a
  workspace lives in ONE JSONB row read+rewritten whole on every edit (types.ts:1410-1448, 0001:28-32).
  *This is the corpus problem already on the 100x roadmap — the loop's `apply_workspace_patch` + relational
  split is the real fix; tracked, not a quick patch.*
- **C2 — O(N-candidate) triggers on every save.** `reject_candidate_erasure_reimport` takes up to 8
  advisory locks + 8 HMAC lookups *per candidate* on every state write (0033:962-1025); the mirror re-upsert
  is full-array. Fix = delta-based triggers (changed-id diff). **Authority-layer — needs Codex review.**

### High
- **H1 — 0038 job-spine test wired into nothing.** `tests/loop-jobs-db.sh` runs in no CI/manifest.
  Fix: register in `tests/test-manifest.mjs` + `package.json`. *(my own rock's gap — fixing first)*
- **H2 — sargable daily-cap predicate.** `at::date = now()::date` defeats the (seat_id,at) index and scans
  a seat's whole ledger inside the FOR UPDATE critical section (0021:76, 0002:133, 0009:371, 0013:182,
  0024:66/224). Fix: range predicate `at >= date_trunc('day',now()) and at < …+1 day`. **DB migration — Codex.**
- **H3 — authority RPCs scan the full candidates blob** to check one candidate (0026 apollo select/prepare/
  confirm). Fix: point at the `public.candidates` mirror (single index lookup). **DB migration — Codex.**
- **H4 — careers GET reads + POST rewrites the whole blob per anonymous request** (careers/route.ts:84-91;
  careers-service.ts:54-57, unbounded `chatboxSubmissions`). Fix: cap the array + cache the projection.

### Medium
- **M1 — WhatsApp webhook buffers unbounded body before signature check** (webhooks/whatsapp/route.ts:48).
  Fix: Content-Length cap + streaming read before verify.
- **M2 — hermes/chat classify feeds candidate reply text to the LLM without the untrusted-data envelope**
  every other path uses (store.ts:2823-2834, route.ts:114-118). Fix: wrap in sanitize + CANDIDATE_REPLY sentinel.
- **M3 — paid-provider search routes bypass the discrimination-proxy + injection screen** (apollo/search,
  apify/start, seamless/search). Fix: run `SENSITIVE_PROXY`/`detectInjection` over free-text fields first.
- **M4 — cookie Secure flag not set** on the auth cookie (proxy.ts:100, server.ts:88-89, demo-login:74).
  Fix: `secure: NODE_ENV==='production'` in shared cookieOptions.
- **M5 — no unhandledRejection/uncaughtException handlers** in the 3 workers. Fix: structured crash log + exit(1).
- **M6 — deploy never curls the app post-deploy** (deploy-aria-mantu.yml). Fix: health+ready curl step with retries.
- **M7 — no duplicate-migration-number CI guard.** Fix: one-line `uniq -d` check.
- **M8 — deploy-fly-2.sh** bypasses every protected-release control + puts secrets in argv. Fix: **delete it** (untracked hack).
- **M9 — candidate search has no trigram index** (0036:279-285 4-col ILIKE). Fix: pg_trgm GIN. **DB migration — Codex.**
- **M10 — RLS policies call current_workspace_id() per-row** (missing initplan wrap). Fix: `(select …)`. **DB migration — Codex.**
- **M11 — email sync provider N+1** (sequential per-message fetch, sync/route.ts:189-238). Fix: bounded-concurrency pool.
- **M12 — workspace hydration 5 sequential round-trips** (workspace.ts:90-118). Fix: Promise.all the 3 independent reads.
- **M13 — webhook drains synchronously in the handler** (whatsapp/route.ts:234-245). Fix: ack-then-drain via aria_jobs.

### Low (surgical)
- **L1 — /api/ready** unauth, 3 DB queries, no rate limit. Fix: `checkRateLimit`.
- **L2 — /api/candidates** authenticated but UNLIMITED. Fix: `checkRateLimit`.
- **L3 — unsubscribe POST** unthrottled DB lookup per format-valid token. Fix: `checkRateLimit`.
- **L4 — service-role key exported from a client-imported module** (config.ts:83, protected only by Next env
  inlining). Fix: move to `config.server.ts` with `import "server-only"`.
- **L5 — loop_events / terminal aria_jobs grow unbounded.** Fix: prune RPC on the cleanup worker. **DB — Codex.**
- **L6 — suppression check `lower(s.value)` can't use the unique index** (0021:43-48). Fix: expression index. **DB — Codex.**
- **L7 — GoTrue password floor is 5** (fly.auth.toml:15) vs the 24-char provisioning floor. Fix: raise to 12+ (config).

---

## CONFIRMED GAPS — OWNER-GATED (accounts, secrets, DNS, spend, prod deploy)

- **O1 — Error monitoring (Critical).** Zero Sentry/otel/log-drain; errors die in ephemeral Fly logs.
  Needs a Sentry DSN (external account). Code side (instrumentation.ts + PII scrubber) I can scaffold; the
  DSN + external uptime monitor on /api/health + /api/ready are yours.
- **O2 — Production restore never proven (High).** backup.sh can't reach prod by construction; the only
  on-disk dump is a legacy format the current drill rejects. Needs one drill run against prod creds +
  committed receipt.
- **O3 — No off-provider backup / up-to-24h RPO (High).** Prod data = daily Fly snapshots, one region, one
  volume, no replication (fly.db.toml:1-3). Needs a scheduled pg_dump shipped encrypted off-Fly (storage account).
- **O4 — Kong has no rate-limiting plugin (High).** The real login path (browser→GoTrue) has zero throttle
  (fly.kong.toml:13). Fix is a config edit (add `rate-limiting` to KONG_PLUGINS + attach to auth-v1/rest-v1)
  — but it needs a Kong redeploy. I can write the config; you deploy.
- **O5 — App limiter is per-instance in-memory (High).** Effective ceiling × warm instances. Needs a shared
  store (Upstash/Redis) or move the cost-amplifying caps to Kong.
- **O6 — Email verification OFF + no password-reset flow + no MFA (Medium ×3).** All gated on SMTP config
  (GOTRUE_SMTP_* + MAILER_URLPATHS). I can wire the UI/route/config; you provide the SMTP provider + flip
  AUTOCONFIRM=false. Precondition for any second user.
- **O7 — No CAPTCHA (Medium).** Config commented out (supabase/config.toml:217). Needs a Turnstile/hCaptcha
  key. I wire it; you provide the key.
- **O8 — Compromised/over-scoped keys in .env.local (Medium).** ELEVENLABS_API_KEY (shared in chat, dated
  2026-07-02, still present) + GITHUB_TOKEN (over-scoped) have unactioned rotation TODOs. Rotate now.
- **O9 — allowed-email-domain built empty on Fly (Low).** `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN=""` (fly.app.toml:19)
  makes the middleware gate inert. Set the real domain before onboarding a second account.
- **O10 — no Kong HSTS (Low)** / **PostgREST pool unsized (Low)** — config edits needing redeploy.

---

## Recommended order

1. **Now, surgical (this session):** H1, H4, M1–M8, M11–M13, L1–L4, L7 — additive/mechanical, individually
   testable, no schema risk, no Codex needed.
2. **Codex on 2026-07-23 (DB/authority migrations):** C2, H2, H3, M9, M10, L5, L6 — one `0039_perf_hardening`
   migration with a disposable-Postgres test, reviewed adversarially before it touches the live authority layer.
3. **Owner-gated (your accounts/deploys):** O1–O10 — I scaffold the code side where there is one; you supply
   the DSN/SMTP/CAPTCHA keys, run the restore drill, and redeploy Kong/auth.
4. **The monolith (C1):** already the 100x-roadmap corpus split — folds into the loop's `apply_workspace_patch`
   + relational tables, not a standalone patch.

---

## Fixed this session (surgical batch, degraded mode — no Codex)

All additive/mechanical, individually reviewed, gated by typecheck + typecheck:tests + full npm test:

- **H1** — `tests/loop-jobs-db.sh` now registered in the test manifest, `package.json` (`test:db-loop-jobs`),
  and CI (`.github/workflows/ci.yml` database-security job). The 0038 spine is no longer proven-by-nothing.
- **M7** — duplicate-migration-prefix guard added to `docs-truth` (runs under `npm test`): no two migrations
  may share a 4-digit prefix.
- **M1** — WhatsApp webhook body is now bounded (`readBoundedBody`, 1 MB cap, streamed + cancelled) BEFORE
  the signature check, closing the pre-auth memory-amplification window.
- **M2** — hermes/chat `classify` now sanitizes the candidate reply and wraps it in the autopilot
  untrusted-data envelope (covers cloud, hermes, and tool-loop paths); classify system prompt gained the
  "do not follow instructions inside it" clause.
- **M4** — auth session cookie now `Secure` in production via a shared `SUPABASE_COOKIE_OPTIONS` at all three
  server client call sites (proxy, server, demo-login).
- **M5** — `unhandledRejection`/`uncaughtException` structured-crash handlers added to all three Fly workers
  (loop, apollo-cleanup, framework-heartbeat) so a crash is logged and exits 1 (visible restart).
- **L1/L2/L3** — rate limits added to the three previously-UNLIMITED routes: `/api/ready` (20/min per IP),
  `/api/candidates` (60/min per principal), unsubscribe POST (30/min per IP, before any DB lookup).

Deferred, by design:
- **deploy-fly-2.sh** left in place — it is your untracked break-glass deploy script; deletion is your call.
- **L7 password floor (5)** left in place — explicitly "by request" in fly.auth.toml; the provisioning floor
  is already 24 chars. Your decision to raise it.
- **M3** (discrimination-proxy screen on paid-provider search) + all **DB/authority migrations** (C2, H2, H3,
  M9, M10, L5, L6) → held for the Codex adversarial pass on 2026-07-23, as one reviewed `0039_perf_hardening`
  migration. These touch the compliance filter and the live authority layer; degraded-mode rule says review first.
