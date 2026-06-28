# Backup & Restore Report — Hermes Sourcing (MSourcing)

**Area:** Phase 5+12 — Backups / Restore / DR — **Gate 12 (Backup/DR)**
**App:** Hermes Sourcing ("hermes-sourcing") — autonomous recruiting operations console
**Stack:** Next.js 14.2 (Vercel serverless, region `cdg1`) · Supabase (managed Postgres) · Microsoft Entra
**Reviewer role:** Backup & DR Engineer
**Date:** 2026-06-27
**Repo state at audit:** branch `main`, **working tree DIRTY** (`git status`: 73 modified, `backups/` untracked) — audited as-is.
**Supersedes / consolidates:** the backup material previously scattered across `OPERATIONS_RUNBOOK.md §1`, `ROLLBACK_RUNBOOK.md`, `RISK_REGISTER.md R1`, `ASSET_REGISTER.md`, `LOCAL_SETUP.md`, `UNKNOWN_ITEMS.md A1/A4/A7/B4/B6`. Those documents remain valid for their primary topics; this report is the authoritative source for Gate 12. Where they conflict with current code (see F-BR-07), this report wins.

---

## 1. Executive summary

Hermes Sourcing is an MVP demo with **no verified production backup, no proven restore, and no defined RTO/RPO.** The repo ships three local ops scripts (`scripts/backup.sh`, `scripts/restore-drill.sh`, `scripts/local-supabase-up.sh`) that operate **only against a local Docker Supabase**, and two committed-to-the-working-tree gzipped `pg_dump` artifacts under `backups/` that are **empty of data** (0 rows in every PII/secret table — confirmed below) and **not encrypted, not gitignored**.

For production the design relies entirely on **Supabase managed backups + PITR**, but:
- **PITR/daily-backup enablement on the production project is UNVERIFIED** (no infra access authorized; no dashboard evidence in repo). Supabase PITR requires the **Pro plan or above** and is **not on by default** — assuming it is enabled is exactly the failure this gate exists to catch.
- **No restore drill has ever been performed or evidenced.** `EVIDENCE_INDEX.md` explicitly lists "restore drill" under *NOT in evidence*. The local drill **could not be run during this audit** (Docker engine not available in the sandbox — `docker info` fails).
- **RTO and RPO are undefined** (business decision B4, still open). The application persistence model (single JSONB document, 600 ms-debounced, last-write-wins upsert) introduces a **silent application-level data-loss path that database backups do not protect against** (F-BR-04).
- Backup artifacts, by design, dump secret-bearing columns (`api_keys.secret`, `email_connections.access_token`/`refresh_token`) and candidate PII **in cleartext** (F-BR-03), compounding the already-open cleartext-at-rest finding (RISK_REGISTER R5 / BACKEND_REVIEW).

**This is a hard production blocker.** Until backups, restore, RTO/RPO, and source off-siting are proven with evidence, no real candidate PII should be onboarded.

---

## 2. Gate 12 decision

| Gate | Verdict | Rationale |
|---|---|---|
| **Gate 12 — Backup / DR** | **FAIL** | Open CRITICAL/HIGH findings: production backup/PITR unverified (F-BR-01), restore never proven (F-BR-02), cleartext-secret/un-gitignored backups (F-BR-03), RTO/RPO undefined + app-level silent data loss (F-BR-04), no off-site source backup (F-BR-05). Several sub-items are **UNKNOWN — blocked on access**; per the conservative rule, unknown ≠ pass, and the open HIGH/CRITICAL items make the gate FAIL regardless. |

**Required to move Gate 12 → PASS** (all of):
1. Evidence that Supabase **daily backups + PITR are enabled** on the production project (dashboard screenshot / API output) with a stated retention window.
2. A **documented, dated restore drill** to an isolated project proving recoverability, with measured restore time and a row/RLS verification (see §6).
3. **RTO and RPO targets agreed** (B4) and shown to be achievable by the drill.
4. **Off-site source backup** (git remote + protected branch) created (A1 / F-BR-05).
5. Backup artifacts **encrypted at rest** and `backups/` **gitignored** (F-BR-03); cleartext-secret-at-rest remediation (RISK R5) at least scheduled.

---

## 3. What exists today (evidence)

### 3.1 Local backup tooling (verified by reading the scripts)
| Artifact | Path | What it does | Scope |
|---|---|---|---|
| Backup script | `scripts/backup.sh:13-30` | `pg_dump` schema-only + data-only into `backups/hermes_<ts>_{schema,data}.sql.gz`, writes `backups/.latest` | **LOCAL Docker Supabase only** (`postgresql://postgres:postgres@127.0.0.1:54322`, `docker ps --filter name=supabase_db`) |
| Restore drill | `scripts/restore-drill.sh:19-39` | Restores latest backup into a throwaway `hermes_restore_drill` DB **inside the same container**, counts public tables, drops scratch, prints PASS/FAIL | LOCAL only; never touches a remote/live DB |
| Local bring-up | `scripts/local-supabase-up.sh:23-38` | `supabase start` + `db reset` (applies migrations 0001-0005), writes `.env.local` | LOCAL only |

`scripts/backup.sh:5` self-declares: *"Encrypted at rest is the operator's job; these are local working backups for the restore drill + dev safety."* — i.e. **no encryption is performed by the tooling.**

### 3.2 Committed backup artifacts (verified by inspection)
```
backups/.latest                              -> 20260627_164402
backups/hermes_20260627_164402_schema.sql.gz  (33.1 KB, full pg_dump --schema-only, Postgres 17.6)
backups/hermes_20260627_164402_data.sql.gz    (15.6 KB, full pg_dump --data-only)
```
Row counts inside the data dump (decompressed + counted per `COPY` block):
```
public.api_keys          -> 0 data rows
public.email_connections -> 0 data rows
public.profiles          -> 0 data rows
public.workspace_state   -> 0 data rows
public.outreach_ledger   -> 0 data rows
auth.users               -> 0 data rows
```
**The artifacts contain schema only; the data dump carries no rows.** This is a fresh local DB dump, not real data. However, the data dump **header still emits the secret-bearing column lists** (`COPY public.api_keys (… secret …)`, `COPY public.email_connections (… access_token, refresh_token …)`), so a non-empty run on a real DB would write those secrets in cleartext to disk (F-BR-03).

Git tracking: `git check-ignore` → **NOT_IGNORED**; `git status --porcelain backups/` → `?? backups/`. The directory is **untracked but not in `.gitignore`** — a `git add .` would stage cleartext dumps. `.gitignore` (read in full) has no `backups/` entry.

### 3.3 Production backup story (documented, NOT verified)
- `ROLLBACK_RUNBOOK.md:184-193` documents Supabase PITR: restore to a **new project**, then repoint `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in Vercel; states *"requires the Pro plan… RTO ~15-30 min… Confirm PITR is enabled… before you need it."*
- `OPERATIONS_RUNBOOK.md:26-71` documents weekly backup verification + quarterly restore-to-new-project drill.
- **None of this is verified** — no Supabase project access was authorized, and there is no dashboard evidence, ops-log entry, or drill output anywhere in the repo (`find` for an ops log returns nothing; `EVIDENCE_INDEX.md` confirms restore drill "NOT in evidence").

### 3.4 Application persistence (verified)
- Live mode persists the **entire app state as one JSONB document** to `public.workspace_state.state` via `saveRemoteState()` — `src/lib/supabase/workspace.ts:63-74`: `upsert({ workspace_id, state, updated_at }, { onConflict: "workspace_id" })`.
- Caller debounces **600 ms** — `src/lib/store.ts:411-413` (`setTimeout(… 600)`), demo mode writes synchronously to `localStorage` (`store.ts:416`).
- Schema confirms one row per workspace: `workspace_state(workspace_id PK, state jsonb, updated_at)` — `supabase/migrations/0001_init.sql:28-31`.

### 3.5 CI / automation (verified)
`.github/workflows/ci.yml` runs typecheck/lint/test/build + non-blocking `npm audit` + gitleaks. **No backup, restore, or migration step in CI** (grep for backup/restore/drill/migrat in `ci.yml` → no matches). No scheduled backup job (no cron, no GitHub Action schedule, no Vercel cron).

---

## 4. RPO / RTO assessment

| Metric | Target | Current reality | Verdict |
|---|---|---|---|
| **RPO (max data loss)** | **UNDEFINED** (B4) | DB layer: Supabase PITR *would* give ~seconds-to-minutes RPO **if enabled** (unverified); without PITR, only daily snapshots → up to **~24 h** loss. App layer: last-write-wins JSONB means concurrent edits silently overwrite — effective RPO for an overwritten field is **immediate and unrecoverable** without a prior snapshot (F-BR-04). | **FAIL / UNKNOWN** |
| **RTO (max downtime)** | **UNDEFINED** (B4) | Code/config: Vercel instant rollback ~30-60 s (`ROLLBACK_RUNBOOK.md:19`, documented, plausible, unverified). Data: PITR restore-to-new-project + Vercel env repoint ~**15-30 min+** (Supabase-quoted, unverified) — and repointing is a **manual, untested** cutover. | **FAIL / UNKNOWN** |
| **Backup frequency** | TBD by RPO | Local: ad-hoc / suggested hourly cron (`LOCAL_SETUP.md:32`). Prod: Supabase default daily **if enabled**. | **UNKNOWN** |
| **Retention** | TBD | Local: unbounded (no rotation/pruning in `backup.sh`). Prod: Supabase plan-dependent (7 days typical / configurable) — **unverified**. | **UNKNOWN** |
| **Immutability / WORM** | TBD | None. Local dumps are plain files on the operator's disk, freely deletable; no object-lock. Prod: Supabase-managed, not verified. | **FAIL / UNKNOWN** |
| **Encryption at rest** | Required (PII + tokens) | Local dumps: **none** (`backup.sh:5`). Prod: Supabase encrypts storage at rest (platform claim, unverified for this project). | **FAIL (local) / UNKNOWN (prod)** |
| **Geo-redundancy / off-site** | TBD | Local dumps live on the same machine as the DB. Source repo has **no git remote** (A1) → single-machine source. | **FAIL** |

**RTO/RPO must be set as a business decision (B4) before backup cadence, retention, and replication can be designed.** See `DISASTER_RECOVERY_PLAN.md §3` for proposed defaults to ratify.

---

## 5. Restore-process verification

**Status: UNKNOWN — could not be executed in this audit; never evidenced previously.**

- Local drill (`scripts/restore-drill.sh`) requires a running Docker Supabase container. `docker info` in the audit sandbox → **DOCKER_NOT_AVAILABLE**. The drill therefore **cannot be run here**, and there is **no prior recorded run** (no ops log, no committed drill output).
- Production restore is **blocked on access** (no Supabase project authorized).
- The drill script itself has reliability weaknesses (F-BR-06) that mean even a "PASS" would be weak evidence: it swallows restore errors with `|| true` (`restore-drill.sh:24-25`) and passes on any `tables >= 1` (`:35`), so a partial/failed restore could still report PASS.

**What is needed to verify restore:** see §6 and `DISASTER_RECOVERY_PLAN.md §6` (DR test plan). Until a dated, error-strict drill output exists, restore is **unproven (FAIL)**.

---

## 6. Restore-verification queries (CORRECTED to the real schema)

> The existing `OPERATIONS_RUNBOOK.md §6/§9` and `ROLLBACK_RUNBOOK.md` audit/spot-check queries reference columns that **do not exist** (`outreach_ledger.contact_email`/`sent_at`, `suppression_list.email`/`suppressed_at`). The real columns (per `supabase/migrations/0002_fleet.sql:34-52`) are `outreach_ledger.candidate_email` / `.at` and `suppression_list.value` / `.created_at`. Use the corrected queries below for any restore verification (F-BR-07).

```sql
-- Table inventory (expect 8 public tables):
SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;
-- agent_seats, api_keys, email_connections, outreach_ledger,
-- profiles, suppression_list, workspace_state, workspaces

-- RLS must be ON for every public table (must return 0 rows):
SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity=false;

-- Row spot-checks (CORRECT columns):
SELECT 'workspace_state' t, count(*) FROM public.workspace_state
UNION ALL SELECT 'outreach_ledger', count(*) FROM public.outreach_ledger
UNION ALL SELECT 'agent_seats', count(*) FROM public.agent_seats;

-- Outreach volume by status (CORRECT: no provider/sent_at columns on ledger):
SELECT status, count(*) n FROM public.outreach_ledger GROUP BY status ORDER BY n DESC;

-- Suppression respected (CORRECT columns value/created_at, candidate_email/at):
SELECT ol.candidate_email
FROM public.outreach_ledger ol
JOIN public.suppression_list sl
  ON sl.type='email' AND lower(sl.value)=lower(ol.candidate_email)
WHERE ol.at > sl.created_at
LIMIT 20;   -- any rows after a restore => suppression history lost/inconsistent

-- Critical: confirm the claim_and_record RPC survived the restore:
SELECT proname FROM pg_proc WHERE proname='claim_and_record';  -- expect 1 row
```

After any restore also verify: (a) `auth.users` count matches expectation, (b) `api_keys`/`email_connections` rows present (they hold the secrets the app needs — see F-BR-03 for the security caveat), and (c) the `workspace_state.state` JSONB parses and the app loads it (`loadRemoteState`, `workspace.ts:38-58`).

---

## 7. Findings

## [CRITICAL] F-BR-01 — Production backups / PITR are unverified (assumed, not proven)
- **Area / system:** Availability & DR — Supabase managed Postgres (production)
- **Affected:** Production Supabase project (no repo evidence); documented-only at `ROLLBACK_RUNBOOK.md:184-193`, `OPERATIONS_RUNBOOK.md:30-34`
- **Description:** The entire production backup posture rests on Supabase daily backups + PITR being enabled. Supabase PITR is a **paid (Pro+) add-on that is OFF by default**; daily backups vary by plan. There is no dashboard screenshot, API output, ops-log entry, or any evidence that either is enabled for this project. The runbooks even say "confirm PITR is enabled before you need it" — that confirmation has not happened.
- **Impact:** If a deletion/corruption/region event occurs and backups/PITR are not actually enabled, **all candidate PII, outreach history, OAuth tokens and API keys are permanently lost.**
- **Likelihood:** Low per-day; catastrophic and total if it occurs.
- **Reproduction:** `grep -rni "PITR\|backup" production-readiness/` returns documentation only; no evidence file. No Supabase access authorized to check the dashboard.
- **Evidence:** `EVIDENCE_INDEX.md` ("restore drill … NOT in evidence"); `UNKNOWN_ITEMS.md` A4, A7, B4; `ROLLBACK_RUNBOOK.md:193`.
- **Recommended fix:** Enable daily backups + PITR on the production project; capture dashboard/API evidence with retention window; record it in the ops log and `EVIDENCE_INDEX.md`.
- **Tests to add:** Weekly automated check that the latest backup is < 25 h old (Supabase Management API) wired to alerting.
- **Status:** UNKNOWN — **blocked on access** (need production Supabase project access + plan/retention decision).
- **Owner:** Tony / Platform · **Residual risk:** Total data loss until proven.

## [CRITICAL] F-BR-02 — Restore has never been proven (no drill executed or recorded)
- **Area / system:** DR — restore process (local + prod)
- **Affected:** `scripts/restore-drill.sh`; production restore path
- **Description:** No restore drill output exists anywhere in the repo, and the local drill could not be executed in this audit (Docker engine unavailable → `docker info` fails). A backup that has never been restored is not a backup. Production restore-to-new-project + Vercel repoint is entirely untested and is a manual cutover.
- **Impact:** Recoverability is unknown. A real incident could discover the backups are corrupt, incomplete, or unrestorable — at the worst possible time.
- **Likelihood:** N/A (this is a verification gap); the consequence is a failed recovery when needed.
- **Reproduction:** `which docker` → present; `docker info` → fails (engine off). `scripts/restore-drill.sh` exits at line 9 ("No local Supabase DB container"). No recorded prior run.
- **Evidence:** `EVIDENCE_INDEX.md` "NOT in evidence: … restore drill"; sandbox `DOCKER_NOT_AVAILABLE`.
- **Recommended fix:** Run the local drill (Docker up) and capture output; then run a production restore-to-isolated-project drill per `DISASTER_RECOVERY_PLAN.md §6`, measuring restore time vs RTO. Record date, backup timestamp, restore time, PASS/FAIL.
- **Tests to add:** Quarterly scheduled restore drill with archived logs; CI job that runs the local drill against an ephemeral Supabase container on a cadence.
- **Status:** OPEN (UNKNOWN to verify here) — blocked on Docker (local) and Supabase access (prod).
- **Owner:** Tony / Platform · **Residual risk:** Recovery may fail when invoked.

## [HIGH] F-BR-03 — Backup artifacts carry cleartext secrets + PII and are not gitignored
- **Area / system:** Data protection — backup confidentiality
- **Affected:** `scripts/backup.sh:23-25`, `backups/` (untracked, not in `.gitignore`), schema `supabase/migrations/0003_api_keys.sql`, `0004_email_connections.sql`
- **Description:** `pg_dump --data-only` emits **every column including `api_keys.secret`, `email_connections.access_token`/`refresh_token` and all candidate PII** in cleartext (the column lists are present in the current dump header even though it currently has 0 rows). The tooling performs **no encryption** (`backup.sh:5` defers it to the operator). `backups/` is **not in `.gitignore`** and is currently untracked (`git status: ?? backups/`), so a `git add .` on the dirty tree would commit cleartext secret/PII dumps. This compounds the open cleartext-at-rest finding (RISK_REGISTER R5 / `BACKEND_REVIEW.md:151`): a backup file is one of the easiest exfiltration vectors for those secrets.
- **Impact:** A leaked/committed backup yields mass compromise of provider API keys and connected Gmail/Graph mailboxes (full `Mail.Send`), plus candidate PII — a reportable breach.
- **Likelihood:** Medium (working tree is dirty; backups sit next to the repo; no encryption).
- **Reproduction:** `git check-ignore backups/...gz` → not ignored; `gunzip -c backups/*_data.sql.gz | grep "COPY public.api_keys"` shows the `secret` column in scope.
- **Evidence:** `backups/` listing; `.gitignore` (no `backups/` entry); `scripts/backup.sh:5,23-25`.
- **Recommended fix:** (1) Add `backups/` (and `*.sql`, `*.sql.gz`) to `.gitignore` immediately. (2) Encrypt dumps at rest (e.g. `age`/`gpg`/`openssl enc` with an off-box key) in `backup.sh`. (3) Remediate cleartext-at-rest in the DB (pgcrypto/pgsodium/KMS — RISK R5) so dumps are not the only weak point. (4) Restrict `backups/` filesystem perms and keep off the repo tree.
- **Tests to add:** gitleaks rule / pre-commit hook rejecting `*.sql.gz` and `backups/`; test asserting the dump file is encrypted (not parseable as plaintext SQL).
- **Status:** OPEN.
- **Owner:** Tony / Platform · **Residual risk:** HIGH until encryption + gitignore landed.

## [HIGH] F-BR-04 — RTO/RPO undefined; app-level last-write-wins JSONB causes silent data loss DB backups can't catch
- **Area / system:** Availability & data integrity
- **Affected:** `src/lib/store.ts:400-416`, `src/lib/supabase/workspace.ts:63-74`, schema `workspace_state` (`0001_init.sql:28-31`)
- **Description:** RTO and RPO are undefined (decision B4 still open) so backup cadence/retention/replication cannot be designed to a target. Separately, the whole app state is **one JSONB document per workspace**, saved with a **600 ms-debounced, last-write-wins `upsert`** (no row-level merge, no optimistic concurrency, no version check). In a shared org workspace, two recruiters editing concurrently will silently overwrite each other; the overwrite is a *legitimate* write, so **DB backups/PITR restore the overwriting value, not the lost one** — the data is gone with an RPO of "immediate" for the overwritten fields, undetectable and unrecoverable short of an older snapshot.
- **Impact:** Silent, unrecoverable loss of recruiter/candidate/outreach edits under normal concurrent use; not mitigated by the very backups this gate relies on.
- **Likelihood:** Medium-High once multiple users share a workspace (the documented tenancy model — `SUPABASE_SETUP.md`).
- **Reproduction:** Two sessions in one workspace edit different fields within 600 ms / before the other's load; later save wins; no conflict surfaced.
- **Evidence:** `store.ts:411-413` (debounce 600), `workspace.ts:67-71` (`onConflict: "workspace_id"`), single-row schema.
- **Recommended fix:** Set RTO/RPO (B4). For the data model: add optimistic concurrency (compare `updated_at`/version on upsert, reject stale writes) or move hot entities (outreach_ledger already normalized) out of the monolithic blob; at minimum surface save conflicts. Document RPO implications of the blob model.
- **Tests to add:** Concurrency test asserting a stale write is rejected or merged, not silently overwritten.
- **Status:** OPEN.
- **Owner:** Tony / Eng · **Residual risk:** HIGH for multi-user workspaces.

## [HIGH] F-BR-05 — No off-site/off-machine backup of source (no git remote)
- **Area / system:** DR — source code / IaC continuity
- **Affected:** Local git repo (branch `main`, no remote)
- **Description:** The repository is local-only with no remote; combined with a dirty working tree (73 modified files, untracked `backups/`), the source — including migrations that ARE the schema-of-record — has **no off-machine copy**. CI cannot run (A2). A disk failure loses the product.
- **Impact:** Total loss of source, migrations, and ops scripts on single-machine failure; no path to redeploy or restore schema.
- **Likelihood:** Low per-day; total if it occurs.
- **Reproduction:** `git remote -v` → empty; `git status` → dirty tree, `?? backups/`.
- **Evidence:** `UNKNOWN_ITEMS.md` A1; `ASSET_REGISTER.md:57` ("no git remote; no off-machine backup; CI cannot run").
- **Recommended fix:** Create a private remote (GitHub/GitLab), commit the dirty tree intentionally (after the `.gitignore` fix in F-BR-03 so backups/secrets are excluded), push `main`, enable branch protection. Confirm CI runs green and attach as evidence (A2).
- **Tests to add:** CI presence check; periodic `git fsck` / bundle archive of the repo to a second location.
- **Status:** OPEN — partly process, partly blocked on a remote being created.
- **Owner:** Tony · **Residual risk:** HIGH until remote + protection exist.

## [MEDIUM] F-BR-06 — Restore-drill script masks errors and uses a weak pass criterion
- **Area / system:** DR — restore verification quality
- **Affected:** `scripts/restore-drill.sh:24-25,35-39`
- **Description:** The restore steps pipe `gunzip … | psql … || true` (lines 24-25), **swallowing all restore errors**, and the pass test is `TABLES >= 1` (line 35). A partial or largely-failed restore (e.g. data load errors, missing RPC, broken RLS) still prints "RESTORE DRILL PASSED". The drill also restores into a scratch DB **inside the same container** as the source, not an isolated host, so it does not exercise a cross-host/cross-project recovery.
- **Impact:** A green drill is not trustworthy evidence of recoverability; false confidence.
- **Likelihood:** Medium (any real-world restore hiccup is hidden).
- **Reproduction:** Read `restore-drill.sh:24-25,35`.
- **Evidence:** script lines above.
- **Recommended fix:** Remove `|| true`; fail on psql non-zero. Assert expected table set (=8), RLS-on for all, presence of `claim_and_record`, and row counts vs the source. Restore to an isolated project/host for prod drills. Emit a machine-readable result + archive it.
- **Tests to add:** Drill self-test on a deliberately corrupted dump must report FAIL.
- **Status:** OPEN.
- **Owner:** Tony / Platform · **Residual risk:** MEDIUM.

## [MEDIUM] F-BR-07 — Runbook drift: restore-verification & audit SQL references non-existent columns
- **Area / system:** Operability of recovery procedures
- **Affected:** `OPERATIONS_RUNBOOK.md:262-283 (§6), 354-368 (§9)`; `ROLLBACK_RUNBOOK.md` spot-checks
- **Description:** The documented audit/verification queries use `outreach_ledger.contact_email`, `outreach_ledger.sent_at`, `suppression_list.email`, `suppression_list.suppressed_at` — **none of which exist**. The real schema (`0002_fleet.sql:34-52`) uses `outreach_ledger.candidate_email` / `.at` and `suppression_list.value` / `.created_at`. Anyone running these during a real restore/incident hits SQL errors and loses time.
- **Impact:** Recovery verification and the suppression-bypass canary fail to run during an incident; slower, error-prone recovery.
- **Likelihood:** High (the queries are wrong as written).
- **Reproduction:** Run the §6 query against the schema → `ERROR: column "contact_email" does not exist`.
- **Evidence:** column names in `0002_fleet.sql:34-52` vs runbook queries.
- **Recommended fix:** Replace with the corrected queries in §6 of this report; do a one-pass schema-accuracy review of all runbook SQL.
- **Tests to add:** A lint test that parses runbook SQL against the live schema (or a `EXPLAIN` smoke against a local DB) in CI.
- **Status:** OPEN.
- **Owner:** Ops/Docs · **Residual risk:** MEDIUM.

## [MEDIUM] F-BR-08 — No migration down-path; rollback is destructive `DROP TABLE` and untested
- **Area / system:** DR — schema rollback
- **Affected:** `ROLLBACK_RUNBOOK.md:64-129`; `supabase/migrations/*` (no down files)
- **Description:** Supabase has no automatic migration down. The documented rollback is manual `DROP TABLE` in reverse order, which **destroys data** (`outreach_ledger` audit trail, `api_keys`, `email_connections` tokens) and has never been tested. There are no paired down-migrations, no transactional wrappers, and no pre-rollback snapshot step mandated.
- **Impact:** A botched migration could force a destructive manual rollback that erases the immutable outreach audit trail and all stored secrets, with no verified restore to fall back on (F-BR-02).
- **Likelihood:** Low-Medium (only on a bad migration), but high consequence.
- **Reproduction:** Read `ROLLBACK_RUNBOOK.md:80-117` (each undo is a `DROP TABLE`).
- **Evidence:** runbook lines; no `*_down.sql` in `supabase/migrations/`.
- **Recommended fix:** Require a fresh backup/PITR bookmark immediately before any migration; author reversible (down) migrations or forward-fix migrations instead of `DROP`; rehearse on staging. Never `DROP` tables holding the audit trail/secrets in prod without a proven restore.
- **Tests to add:** Migration up+down round-trip on an ephemeral DB in CI.
- **Status:** OPEN.
- **Owner:** Eng · **Residual risk:** MEDIUM.

## [MEDIUM] F-BR-09 — Backup retention / immutability / geo-redundancy / key custody undefined and unverified
- **Area / system:** DR — backup policy
- **Affected:** Production Supabase config (unverified); `scripts/backup.sh` (no rotation)
- **Description:** No defined or verified retention window, no immutability/object-lock/WORM, no documented geo-redundancy, and no encryption-key custody/rotation plan for backups. Local `backup.sh` never prunes (unbounded growth) and writes plaintext (F-BR-03). Prod retention/redundancy are Supabase-plan-dependent and unverified.
- **Impact:** Ransomware/insider could delete mutable backups; over-retention of PII breaches data-minimisation; under-retention misses recovery points; unclear key custody undermines encrypted backups.
- **Likelihood:** Medium.
- **Reproduction:** No retention config in repo; `backup.sh` has no prune logic.
- **Evidence:** `backup.sh:17-30`; absence of any retention/immutability config.
- **Recommended fix:** Define retention to match RPO + legal hold; enable immutable/object-locked off-site copies; document encryption key custody + rotation; add rotation/pruning to local script.
- **Status:** UNKNOWN (prod) / OPEN (local) — blocked on access + B4/B5 decisions.
- **Owner:** Tony / Platform + DPO · **Residual risk:** MEDIUM.

## [LOW] F-BR-10 — No break-glass procedure, DR ownership, or DR test schedule defined
- **Area / system:** DR governance
- **Affected:** production-readiness docs (gap)
- **Description:** No documented break-glass access path (who can restore, with which credentials, under what approval), no named DR owner/on-call, and no recurring DR test schedule with acceptance criteria. `OPERATIONS_RUNBOOK.md` lists a quarterly drill cadence but with no owner accountability or escalation.
- **Impact:** Slow, ad-hoc, key-person-dependent recovery; possible inability to access restore controls during an incident.
- **Recommended fix:** Adopt the break-glass + ownership + test-schedule sections in `DISASTER_RECOVERY_PLAN.md §5/§6` and `BUSINESS_CONTINUITY_PLAN.md §4`; assign owners (B8).
- **Status:** OPEN (addressed by the DR/BCP deliverables here; needs owner sign-off).
- **Owner:** Tony · **Residual risk:** LOW once owners assigned.

## [LOW] F-BR-11 — GDPR erasure-from-backups not addressed
- **Area / system:** Privacy ⨯ backup retention
- **Affected:** `outreach_ledger` (immutable, no DELETE — `0005_rls_tenant_isolation.sql:293-294`); backup copies
- **Description:** Art. 17 erasure isn't implemented across `outreach_ledger` (B6), and there is no documented procedure for honouring erasure in backups (e.g. crypto-shredding, or a documented "erasure applies on restore" exception with retention limits). Backups will retain PII after a subject is deleted from the live DB.
- **Impact:** Erasure requests not fully satisfied; compliance exposure (for human/legal review — not a compliance determination).
- **Recommended fix:** Decide retention so backups age out within the documented window; document the backup-erasure stance; cross-ref `OPERATIONS_RUNBOOK.md §9`.
- **Status:** OPEN — blocked on B5/B6 decisions + legal review.
- **Owner:** DPO / Tony · **Residual risk:** LOW (no real PII yet).

## [LOW] F-BR-12 — DR detection is blind (health endpoint not wired to alerting)
- **Area / system:** Detection feeding DR
- **Affected:** `src/app/api/health/route.ts` (exists), no consumer
- **Description:** `/api/health` exists but nothing consumes it; no backup-failure or outage alerting (RISK_REGISTER R3). DR can't start promptly if no one is alerted. A failed Supabase backup would go unnoticed until the weekly manual check.
- **Impact:** Detection latency widens effective RTO and the data-loss window.
- **Recommended fix:** External uptime monitor on `/login` + `/api/keys` (401 canary) per `OPERATIONS_RUNBOOK.md §5`; Supabase backup-age check → alert (A6).
- **Status:** OPEN — cross-ref R3, blocked on monitoring-stack decision (A6).
- **Owner:** Tony / Platform · **Residual risk:** LOW (pre-prod).

---

## 8. What is needed to clear Gate 12 (access/decisions)

| Need | Type | Unblocks |
|---|---|---|
| Production Supabase project access (or staging) | Access | F-BR-01, F-BR-02 (prod), F-BR-09 verification |
| Docker engine available to run the local drill | Access/env | F-BR-02 (local), F-BR-06 |
| RTO/RPO targets (B4) | Decision | §4, F-BR-04, retention design |
| Retention + compliance scope (B5) | Decision | F-BR-09, F-BR-11 |
| Git remote + branch protection (A1) | Action | F-BR-05, A2 |
| Asset/DR ownership + on-call (B8) | Decision | F-BR-10 |
| Monitoring/alerting stack (A6) | Decision | F-BR-12 |

---

## 9. Cross-references
- `DISASTER_RECOVERY_PLAN.md` — DR scenarios, RTO/RPO defaults to ratify, break-glass, DR test plan.
- `BUSINESS_CONTINUITY_PLAN.md` — BIA, continuity strategies, roles, comms.
- `RISK_REGISTER.md` R1 (data loss), R5 (cleartext secrets), R3 (monitoring).
- `ROLLBACK_RUNBOOK.md`, `OPERATIONS_RUNBOOK.md` (apply F-BR-07 corrections).
- `UNKNOWN_ITEMS.md` A1, A4, A7, B4, B5, B6, B8.
- `RELEASE_GATE_MATRIX.md` Gate 12 (this report is the authority).
