# DATABASE_REVIEW.md — MSourcing (hermes-sourcing)

**Phase 5 — Database** · Maps to **Gate 5 — Data/database**
Reviewer: Database & Data Engineer (production-readiness review)
Date: 2026-06-27 · Branch `main`, **working tree DIRTY**
Scope: Supabase Postgres schema/migrations under `supabase/`, constraints/indexes/FKs, RLS / tenant
isolation, DB roles & least-privilege, service-role key usage scope, encryption in transit/at rest
(managed), migration up/down safety.

Baselines applied: OWASP ASVS L2/L3 (sensitive-data + multi-tenant parts), OWASP API Top 10, OWASP
Top 10, NIST SSDF, CIS Controls / CIS PostgreSQL Benchmark.

> This supersedes the Gate-5 row in `RELEASE_GATE_MATRIX.md` ("localStorage demo; Supabase RLS
> unproven"). The schema/RLS layer has since been substantially built out (`0001`–`0005`). The
> still-valid prior verdict (FAIL) is preserved; the *reasons* are updated against the current tree
> with fresh evidence below.

---

## Executive summary

The data layer is **far more mature than the prior matrix implies** — there is a real, thoughtfully
designed multi-tenant RLS model (workspace-scoped, SECURITY DEFINER helpers with pinned
`search_path`, column-level grants that withhold secrets from the `authenticated` role, an atomic
anti-double-contact RPC backed by a partial unique index, FK cascades, and an explicit
least-privilege grant layer that revokes `anon`/`public`). On design, much of this would meet ASVS
L2 and parts of L3.

It is **not releasable** for real users + sensitive PII, for these reasons:

1. **The two most security-relevant migrations are not committed.** `0004_email_connections.sql`
   and `0005_rls_tenant_isolation.sql` are **untracked** in git (`git ls-files supabase/` returns
   only `0001`–`0003`). `0005` is the *authoritative* tenant-isolation hardening layer (anon
   revoke, admin-gated fleet writes, the missing `workspace_state` UPDATE `WITH CHECK`, etc.).
   `SUPABASE_SETUP.md` enumerates only migrations 1–4. Any deploy from the committed tree, any CI
   check, or any operator following the numbered SQL-editor steps ships **without** the hardening
   and **without** the `email_connections` table.
2. **The outreach ledger — the central anti-double-contact / compliance control — is freely
   mutable by any authenticated member.** A non-admin can `UPDATE` ledger rows (no column
   restriction), flip a `sent` row's status to drop it out of the de-dup partial index and the
   re-contact window, then re-claim and re-email the same candidate. Same path lets them tamper the
   "immutable audit trail" (rewrite `candidate_email`, backdate `at`).
3. **Secrets are stored as plaintext columns** (`api_keys.secret`, `email_connections.access_token`
   / `refresh_token`). Protection is RLS + managed disk encryption + service-role secrecy only; no
   app-level / envelope / KMS encryption. `pgcrypto` is installed but used only for UUIDs.
4. **None of the RLS policies or the `claim_and_record` RPC are verified by any test.** CI has no
   Supabase/SQL/migration step; the `tests/` "migration" suites cover only the in-memory JSONB
   state-shape migration. Per the operating rules, an untested security control is not a PASS.
5. **Backups / PITR / restore are unverified**, and there are **no down/rollback migrations**.

**Gate 5 verdict: FAIL** (open HIGH items above; UNKNOWN on prod auth config and backups/DR).

### Positives worth preserving (evidence of good controls)
- RLS enabled on all 8 application tables (`0001`–`0005`).
- `current_workspace_id()` / `current_profile_role()` are `SECURITY DEFINER … set search_path =
  public` — avoids recursive RLS and search-path hijack (`0001_init.sql:43,49`).
- `profiles` insert/update policies block self-tenant-hop and self-promotion via `IS NOT DISTINCT
  FROM` pins (`0001_init.sql:60-69`, re-asserted `0005:129-150`).
- Column-level grants withhold `secret` / tokens from `authenticated`
  (`0003_api_keys.sql:25-27`, `0004_email_connections.sql:25-27`, re-asserted `0005:71-81`).
- Atomic claim RPC + partial unique index give a real server-side de-dup guarantee *for the happy
  path* (`0002_fleet.sql:56-58,80-151`).
- Explicit `revoke all … from anon, public` + minimal `authenticated` grants (`0005:31-81`).
- FK referential integrity with sensible `ON DELETE` (CASCADE for tenant data, SET NULL for
  `profiles.workspace_id` and `outreach_ledger.seat_id`).

---

## Gate decision

| Sub-check | Status | Evidence |
|---|---|---|
| Schema / migrations present & ordered | PARTIAL | `0001`–`0005` exist and are header-ordered; but `0004`/`0005` are **untracked** (`git ls-files supabase/`) → not in the deployable artifact |
| RLS / tenant isolation (design) | PARTIAL | Well-designed workspace scoping (`0005`); **but unverified by any test** and depends on uncommitted `0005` |
| RLS / tenant isolation (verified) | FAIL/UNKNOWN | No pgTAP / `supabase db reset` / integration test; CI has no DB step |
| DB roles least-privilege | PASS (design) | `0005:31-81` revoke anon/public + minimal authenticated + column-level secret withholding |
| Service-role key scope | PARTIAL | Server-only, never `NEXT_PUBLIC` (`config.ts:16`, `server.ts:42-47`); but bypasses RLS — scoping depends on each route deriving `workspace_id` correctly (cross-ref BACKEND_REVIEW) |
| Secret handling / encryption at rest (app-level) | FAIL | Plaintext secret/token columns; no envelope/KMS; `pgcrypto` unused for secrets |
| Audit-trail / guardrail integrity | FAIL | `outreach_ledger` member-UPDATE-able → anti-double-contact bypass + audit tampering |
| Constraints / indexes / FKs | PARTIAL | FKs good; missing enum CHECKs; missing workspace_id indexes; one duplicate index |
| Migration up/down safety | PARTIAL | Forward migrations idempotent & re-runnable; **no down/rollback migrations** |
| Encryption in transit | PARTIAL/UNKNOWN | PostgREST over HTTPS; `db.ssl_enforcement` commented out in `config.toml`; direct-connection sslmode not pinned in repo |
| Backups / PITR / restore | UNKNOWN | Asserted in `DEPLOYMENT.md:84`; no plan tier / PITR / RPO/RTO / tested restore evidence |

**Overall Gate 5: FAIL.**

---

## Findings

## [HIGH] Tenant-isolation hardening migration (0005) and email_connections (0004) are untracked — committed-tree / CI / documented deploy ships without them
- **Area:** Migrations / release integrity / tenant isolation
- **Affected:** `supabase/migrations/0005_rls_tenant_isolation.sql`, `supabase/migrations/0004_email_connections.sql` (both `??` untracked); `SUPABASE_SETUP.md:24-39`; `.github/workflows/ci.yml` (no DB step)
- **Description:** `git ls-files supabase/` returns only `0001`–`0003`. `git status --short supabase/` shows `?? …/0004_…` and `?? …/0005_…` (plus `?? supabase/config.toml`, `?? supabase/.gitignore`). `0005` is the authoritative RLS control layer: it revokes `anon`/`public`, replaces the broad `FOR ALL` "rw" fleet policies (`0002:67-76`) with admin-gated writes, and adds the **`workspace_state` UPDATE `WITH CHECK`** that is missing from `0001` (`0001:84-85` has `USING` but no `WITH CHECK`). `SUPABASE_SETUP.md` lists only migrations 1–4 in its run order, never mentioning `0005`.
- **Impact:** A deploy built from the committed tree, a CI clone, or an operator following the numbered SQL-editor steps gets: (a) **no `email_connections` table** → OAuth callbacks and `outreach/send` token reads fail; (b) **the permissive `0002` "rw" fleet policies** (any member writes seats/suppression, no admin gate); (c) **no `WITH CHECK` on `workspace_state` UPDATE** → a member can re-point their state row's `workspace_id` to a foreign/un-seeded tenant slot (USING limits which rows are updatable, but without WITH CHECK the *new* `workspace_id` is unconstrained) → tenant-isolation write bypass; (d) **no `anon`/`public` revoke** defense-in-depth. With sensitive candidate PII this is a tenant-isolation + release-reproducibility failure. Escalates to **CRITICAL** if any environment is provisioned without `0005`.
- **Likelihood:** High that at least one of {CI, a clean clone, the documented manual path} omits `0005`/`0004`. `supabase db push` (CLI) would include them; the SQL-editor path will not.
- **Reproduction:** `git ls-files supabase/` → only `0001`–`0003`. `git status --short supabase/` → `0004`/`0005` are `??`. Read `SUPABASE_SETUP.md:24-39` → stops at migration 4.
- **Evidence:** command output above; `0001_init.sql:84-85` (no WITH CHECK) vs `0005:177-181` (adds it); `0002_fleet.sql:67-76` (FOR ALL "rw") vs `0005:191-221` (admin-gated).
- **Recommended fix:** `git add supabase/migrations/0004_*.sql supabase/migrations/0005_*.sql supabase/config.toml`, commit, and add a CI job that runs `supabase db reset` (or `db push` to an ephemeral DB) so migrations are validated on every PR. Update `SUPABASE_SETUP.md` to include `0005` (or instruct `supabase db push` only).
- **Tests to add:** CI migration-apply job; post-migrate assertion that `email_connections` exists and that `workspace_state` UPDATE has a `WITH CHECK`.
- **Status:** OPEN · **Owner:** Tony · **Residual risk:** High until committed + CI-validated.

## [HIGH] outreach_ledger is member-mutable — anti-double-contact guardrail bypass + audit-trail tampering
- **Area:** RLS / data integrity / compliance control
- **Affected:** `supabase/migrations/0005_rls_tenant_isolation.sql:69` (grant `update`), `:287-291` (members update policy), `:56-58` (partial unique index), `0002_fleet.sql:111-117,132-134` (re-contact + cap logic keyed on `status in ('claimed','sent')`)
- **Description:** The `authenticated` role has `UPDATE` on `outreach_ledger` and the RLS update policy only checks `workspace_id = current_workspace_id()` in both `USING` and `WITH CHECK` — **no column restriction**. The de-dup partial unique index and the re-contact-window/daily-cap checks all filter on `status in ('claimed','sent')`. Any member can `UPDATE` an existing `sent` row to a status outside that set (e.g. `'reset'`), which removes it from the partial unique index *and* from the re-contact window, then re-`claim_and_record()` the same candidate → re-email. The same UPDATE can rewrite `candidate_email`, `seat_id`, or backdate `at`.
- **Impact:** Defeats the central anti-double-contact / anti-ban / compliance guarantee the whole ledger exists to provide (over-contacting candidates → deliverability/ban risk, and potential CAN-SPAM/GDPR consent issues). Also makes the "immutable audit trail" (claimed in `0005:261-267`) mutable in every column except via DELETE. No admin role required.
- **Likelihood:** Medium (requires an authenticated member acting maliciously or a compromised member token / an app bug issuing such an update), but the control is load-bearing.
- **Reproduction (logical):** As a member: `update outreach_ledger set status='void' where id=<a sent row>` (passes RLS — same workspace) → row leaves the partial unique index and re-contact filter → `select claim_and_record(<same candidate>, …)` returns `allowed:true`.
- **Evidence:** `0005:69,287-291`; partial index `0002:56-58`; status-keyed checks `0002:111-117,132-134`.
- **Recommended fix:** Remove broad member UPDATE on `outreach_ledger`. Reconcile `claimed → sent/skipped` server-side via a `SECURITY DEFINER` RPC (mirroring `claim_and_record`) that only transitions allowed status values and forbids editing `candidate_*`/`at`/`seat_id`/`workspace_id`; or add a `BEFORE UPDATE` trigger that rejects changes to immutable columns and disallowed status transitions. Add a `CHECK (status in ('claimed','sent','skipped','bounced',…))`.
- **Tests to add:** pgTAP/integration: member cannot mutate a `sent` row to escape the unique index; member cannot edit `candidate_email`/`at`; re-claim after status-flip is rejected.
- **Status:** OPEN · **Owner:** Tony · **Residual risk:** High — this is the core outreach safety control.

## [HIGH] Secrets stored as plaintext columns (api_keys.secret, email_connections tokens) — no app-level/envelope encryption
- **Area:** Encryption at rest / secret handling
- **Affected:** `0003_api_keys.sql:14` (`secret text not null`), `0004_email_connections.sql:13-14` (`access_token`, `refresh_token`), `0001_init.sql:8` (`pgcrypto` installed but used only for `gen_random_uuid`)
- **Description:** Provider API keys and OAuth mailbox access/refresh tokens are persisted as cleartext columns. Confidentiality relies entirely on RLS + column-level grants + Supabase managed disk encryption + the service-role key staying secret. There is no application-level envelope encryption (KMS/pgsodium/Vault), so a DB backup exfiltration, a leaked service-role key, a SQL-injection on any service-role path, or a Supabase support/incident with raw disk access yields **plaintext `Mail.Send` tokens and provider keys**.
- **Impact:** Mailbox takeover + provider-key abuse. For an app whose stated sensitive data is "OAuth mailbox tokens, API keys," this is below the ASVS L3 bar for the sensitive-data parts.
- **Likelihood:** Low (requires DB/service-role/backup compromise) but impact is severe.
- **Evidence:** column defs above; `pgcrypto` present at `0001:8`, never referenced for these columns.
- **Recommended fix:** Envelope-encrypt secrets at rest: Supabase Vault / `pgsodium` column encryption, or app-level AES-GCM with a KMS-managed DEK; store only ciphertext + key id, decrypt server-side via service-role. Keep the existing column-level grant as defense-in-depth.
- **Tests to add:** assert stored column is ciphertext (no plaintext key/token in a raw `select` by service-role of the encrypted column); round-trip decrypt test.
- **Status:** OPEN (cross-ref `BACKEND_REVIEW.md` HIGH "secrets at rest") · **Owner:** Tony · **Residual risk:** High until envelope encryption added.

## [HIGH] RLS policies and claim_and_record RPC are unverified — no DB/SQL test in CI
- **Area:** Verification / test coverage of security controls
- **Affected:** `.github/workflows/ci.yml` (no `supabase`/`psql`/migration step — grep returns nothing); `tests/*.mts` (the "migration" suites — `hermes-live.mts`, `audit-fixes.mts` — test the in-memory JSONB **state-shape** migration, not SQL); `tests/rbac-keys.mts` tests app-level `can()` not DB RLS
- **Description:** The entire tenant-isolation guarantee lives in SQL RLS + SECURITY DEFINER functions + the claim RPC, none of which is exercised by any automated test or CI step. There is no pgTAP, no `supabase db reset`, no per-role/cross-workspace integration test.
- **Impact:** Correct-by-inspection only. A future migration or policy edit can silently open cross-tenant reads/writes with nothing to catch it. Per operating rules, an unverified security control = not PASS.
- **Likelihood:** N/A (gap, not exploit) — but it is the reason RLS cannot be marked PASS.
- **Evidence:** `grep -niE "supabase|migration|psql|postgres|sql|rls" .github/workflows/ci.yml` → empty; `tests/` migration refs are JSONB-state only.
- **Recommended fix:** Add a CI job that spins up Postgres (`supabase start` or a Postgres service), applies all migrations, and runs pgTAP/SQL tests proving: anon reads nothing; member sees only own-workspace rows on every table; member cannot self-promote `role` or change `workspace_id`; non-admin cannot write `api_keys`/`email_connections`/fleet tables; `secret`/token columns never returned to `authenticated`; `claim_and_record` enforces suppression/re-contact/cap; ledger immutability.
- **Tests to add:** the pgTAP suite above.
- **Status:** OPEN · **Owner:** Tony · **Residual risk:** High — security posture asserted, not demonstrated.

## [HIGH] Tenant assignment trusts the email domain; safety depends on unverifiable prod auth config (local config is insecure)
- **Area:** Tenant isolation / auth-to-DB trust boundary
- **Affected:** `0001_init.sql:89-127` (`ensure_workspace()` keys workspace by `split_part(email,'@',2)`); `supabase/config.toml:176,182,221,226` (`enable_signup = true`, `minimum_password_length = 1`, email `enable_signup = true`, `enable_confirmations = false`)
- **Description:** `ensure_workspace()` (SECURITY DEFINER) reads the caller's `auth.users.email`, derives the domain, and auto-joins them to the **shared org workspace** for that domain — granting access to all candidate PII / outreach / ledger / connection metadata in that tenant. The control that makes this safe is "the email is verified and owned by the user," which is **only** true for federated OAuth (Google/Microsoft). Email/password sign-up with unconfirmed emails breaks it. Production auth-provider settings are configured in the Supabase **dashboard** (not in the repo) and cannot be verified here. The committed local `config.toml` shows email signup **enabled**, **`enable_confirmations = false`**, and **`minimum_password_length = 1`** — if mirrored to prod, an attacker can register `attacker@victimcorp.com` (never proving ownership) and be auto-placed in victim's tenant.
- **Impact:** Cross-tenant data access (CRITICAL class) if prod allows unverified email sign-up.
- **Likelihood:** UNKNOWN for prod (dashboard-managed). Insecure in the committed local config.
- **Reproduction:** Cannot verify without prod auth-config access. Logically: enable email signup + confirmations off → sign up with any corporate domain → `ensure_workspace()` joins that org's shared workspace.
- **Evidence:** `0001:102-118`; `config.toml:176,182,221,226`.
- **Recommended fix:** Enforce OAuth-only (or require `email_confirmed_at` before `ensure_workspace()` provisions a workspace — add `if (select email_confirmed_at from auth.users where id=uid) is null then raise exception` guard). Disable email signup in prod, set `minimum_password_length>=8`, `enable_confirmations=true`. Prefer explicit invite-based workspace membership over implicit domain auto-join.
- **Tests to add:** integration test that an unconfirmed email cannot provision/join a workspace; document prod auth settings as a release-gate checklist item.
- **Status:** UNKNOWN (blocked on prod auth-config access) · **Owner:** Tony+Supabase admin · **Residual risk:** High until prod auth config is verified OAuth-only / confirmation-gated.

## [MEDIUM] No down/rollback migrations; no scripted schema rollback
- **Area:** Migration up/down safety
- **Affected:** `supabase/migrations/*.sql` (all forward-only)
- **Description:** Migrations are forward-only and idempotent (`create … if not exists`, `drop policy if exists` then create, `create or replace`), which is good for re-apply but provides **no down path**. A bad schema change has no scripted rollback, and (see backups finding) there is no verified PITR to roll back to.
- **Impact:** A defective migration in prod cannot be cleanly reverted; recovery would be manual and ad-hoc against live PII.
- **Likelihood:** Medium over the life of the app.
- **Evidence:** no `down`/`revert` SQL anywhere; `ROLLBACK_RUNBOOK.md` covers app/deploy rollback, not schema.
- **Recommended fix:** For each non-trivial migration add a paired tested rollback (or use a tool that tracks reversible migrations), and require PITR be enabled before any prod schema change. Document the schema-rollback procedure in `ROLLBACK_RUNBOOK.md`.
- **Status:** OPEN · **Owner:** Tony · **Residual risk:** Medium.

## [MEDIUM] Backups / PITR / restore unverified
- **Area:** Backup & DR (data layer)
- **Affected:** `DEPLOYMENT.md:82-86` ("Supabase provides managed backups")
- **Description:** Backups are asserted, not evidenced. No proof of the Supabase plan tier (free tier has no daily backups), whether PITR is enabled, the RPO/RTO, or a tested restore drill. Per operating rules, unverifiable backup = UNKNOWN/FAIL.
- **Impact:** Potential unrecoverable loss of candidate PII, outreach ledger (compliance record), and mailbox connections.
- **Likelihood:** UNKNOWN.
- **Evidence:** `DEPLOYMENT.md:84`; no PITR/restore artifact in repo.
- **Recommended fix:** Confirm plan tier + enable PITR; define RPO/RTO; perform and document a restore drill to a scratch project; record evidence in `EVIDENCE_INDEX.md`. (Cross-ref Gate 12.)
- **Status:** UNKNOWN (blocked on Supabase project access) · **Owner:** Tony · **Residual risk:** High for prod data.

## [MEDIUM] workspace_state is a single unconstrained JSONB document per workspace
- **Area:** Schema design / data integrity / least-privilege within a tenant
- **Affected:** `0001_init.sql:28-32` (`workspace_state.state jsonb`), `src/lib/supabase/workspace.ts:63-76` (full-document upsert), `0005:163-181` (every member read+write)
- **Description:** All operational data (candidate PII, outreach, replies, bookings, reports, activity ledger) is one JSONB blob per workspace, readable and overwritable by **every** member. No schema validation, no per-entity RLS, no field-level least-privilege, and no optimistic concurrency — the client upserts the whole document, so concurrent editors clobber each other (lost-update / data loss; detailed in `BACKEND_REVIEW.md`). The row can grow unbounded (TOAST), and `max_rows` does not bound a single row's size. (Confirmed positive: raw secrets are **not** in this blob — `types.ts:755,795,811` — secrets live in `api_keys`/`email_connections`.)
- **Impact:** Lost updates in a "shared multi-tenant console"; no intra-tenant least-privilege; whole-tenant PII exposed to every member; operational ceiling on document size.
- **Likelihood:** High for the lost-update path (routine concurrent use); the rest is design risk.
- **Evidence:** column def `0001:28-32`; upsert `workspace.ts:67-70`; no `rev`/version column.
- **Recommended fix:** Add optimistic concurrency (`rev int` / `updated_at` conditional update) at minimum; longer term normalize into per-entity tables with row-level RLS so independent edits don't collide and intra-tenant least-privilege becomes possible. (Cross-ref BACKEND_REVIEW concurrency HIGH.)
- **Status:** OPEN · **Owner:** Tony · **Residual risk:** Medium-High.

## [MEDIUM] Missing FK / workspace_id indexes — RLS forces sequential scans at scale
- **Area:** Performance / scalability
- **Affected:** `agent_seats` (no index on `workspace_id`), `api_keys` (no `workspace_id` index), `profiles.workspace_id` (FK, unindexed), `outreach_ledger` (no standalone `workspace_id` index for the members-read reporting policy)
- **Description:** Every RLS policy filters by `workspace_id = current_workspace_id()`, but several FK/`workspace_id` columns have no supporting index. `outreach_ledger` reporting reads (`members read` policy) and `api_keys`/`agent_seats` list reads will sequential-scan. The partial unique index covers `(workspace_id, candidate_id)` for de-dup, and `(seat_id, at)` covers the cap query, so the hot RPC paths are OK; the gaps are on list/report reads.
- **Impact:** Degrading query latency as tenants/ledger grow; amplified because RLS adds the predicate to every query.
- **Evidence:** index inventory from `grep` of migrations (only PKs, the two `outreach_ledger` indexes, the redundant `email_connections` index, and unique constraints).
- **Recommended fix:** Add `create index on public.agent_seats (workspace_id)`, `… api_keys (workspace_id)`, `… profiles (workspace_id)`, and `… outreach_ledger (workspace_id, at desc)`.
- **Status:** OPEN · **Owner:** Tony · **Residual risk:** Medium at scale, Low at demo volume.

## [LOW] Missing CHECK constraints on enum-like text columns
- **Area:** Constraints / data integrity (defense-in-depth)
- **Affected:** `profiles.role` (`0001:24`), `agent_seats.status` & `.mode` (`0002:14-15`), `outreach_ledger.status` (`0002:49`), `api_keys.status` (`0003:16`)
- **Description:** Only `suppression_list.type` and `email_connections.provider` have CHECK constraints. `role`, the various `status` columns, and `mode` are free text. The de-dup index and cap logic depend on `status ∈ {claimed,sent}` with no DB-level guarantee; `role` has no `CHECK (role in ('member','admin'))` despite RLS comparing it to `'admin'`.
- **Impact:** A buggy or malicious write can set out-of-domain values; contributes to the ledger-mutability finding (HIGH) by allowing arbitrary status strings.
- **Recommended fix:** Add CHECK constraints to all enum-like columns.
- **Status:** OPEN · **Owner:** Tony · **Residual risk:** Low.

## [LOW] Redundant duplicate index on email_connections
- **Area:** Schema hygiene / write performance
- **Affected:** `0004_email_connections.sql:19` (`unique (workspace_id, seat_id)`) and `:45` (`create index … email_connections_seat_idx on … (workspace_id, seat_id)`)
- **Description:** The `UNIQUE (workspace_id, seat_id)` constraint already creates an index on exactly `(workspace_id, seat_id)`; the explicit `email_connections_seat_idx` on the same columns is redundant — wasted storage and extra write overhead, no read benefit.
- **Recommended fix:** Drop `email_connections_seat_idx` (the unique constraint's index suffices). If a `seat_id`-leading lookup is needed, index `(seat_id)` instead.
- **Status:** OPEN · **Owner:** Tony · **Residual risk:** Low.

## [LOW] config.toml uncommitted and carries insecure local defaults
- **Area:** DB / auth configuration hygiene
- **Affected:** `supabase/config.toml` (untracked) — `:84-85` (`db.ssl_enforcement` commented out), `:73-81` (`db.network_restrictions` allow `0.0.0.0/0` + `::/0`), `:18` (`max_rows = 1000`), `:182` (`minimum_password_length = 1`)
- **Description:** The Supabase CLI config is untracked (so the project's local-stack contract isn't version-controlled) and contains insecure-by-default values: SSL not enforced for direct connections, DB network-restriction management disabled with allow-all CIDRs, `max_rows=1000` (PostgREST will silently truncate large ledger/report reads), weak password floor. These are *local-dev* values and prod equivalents are dashboard-managed (and unverified here), but they signal the configured posture.
- **Impact:** Mostly local; `max_rows=1000` could silently under-count ledger/report queries in any environment using this value.
- **Recommended fix:** Commit `config.toml`; enable `db.ssl_enforcement`; tighten password floor; treat `max_rows` truncation explicitly with pagination in report queries. Verify prod (dashboard) equivalents and record evidence.
- **Status:** OPEN (prod values UNKNOWN — blocked on dashboard access) · **Owner:** Tony · **Residual risk:** Low.

---

## Blockers (access / decisions needed)
1. **Supabase project access** (dashboard or admin) to verify: plan tier, PITR/backups enabled + a tested restore, prod auth-provider config (OAuth-only? email signup/confirmations? password policy), `max_rows`, network restrictions, SSL enforcement. Until then backups/DR and the domain-trust auth finding stay UNKNOWN.
2. **Decision:** commit `0004`/`0005`/`config.toml` and add a CI migration+RLS test job (unblocks the untracked-migration HIGH and the unverified-RLS HIGH).
3. **Decision:** envelope-encryption approach for secrets (Vault/pgsodium vs app-level KMS).
4. **Decision:** intra-tenant model — keep shared-workspace JSONB blob (accept lost-update + no intra-tenant least-privilege) or normalize.

## Evidence index (commands run)
- `git ls-files supabase/` → `0001`,`0002`,`0003` only.
- `git status --short supabase/` → `?? 0004_…`, `?? 0005_…`, `?? config.toml`, `?? .gitignore`.
- `grep -niE "supabase|migration|psql|postgres|sql|rls" .github/workflows/ci.yml` → no matches (no DB step).
- `grep -niE "check \(" supabase/migrations/*.sql` → CHECKs only on `suppression_list.type`, `email_connections.provider`.
- Index inventory grep → PKs, `outreach_ledger_active_uniq` (partial), `outreach_ledger_seat_day`, `email_connections_seat_idx` (redundant), unique constraints.
- `src/lib/supabase/{server,config,workspace}.ts` reviewed for service-role scope and persistence path.
- `src/lib/types.ts:755,795,811` confirm secrets are not persisted in the `workspace_state` JSONB blob.
