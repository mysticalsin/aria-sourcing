# Disaster Recovery Plan — Hermes Sourcing (MSourcing)

> SUPERSEDED by `STATUS.md` 2026-07-10 for current release posture. Historical 2026-06-27 evidence may contain stale stack versions, suite counts, migration ranges, and verdicts.


**Gate:** Gate 12 — Backup/DR · **Companion to:** `BACKUP_RESTORE_REPORT.md`, `BUSINESS_CONTINUITY_PLAN.md`
**Stack:** Next.js 14.2 on Vercel serverless (region `cdg1`) · Supabase managed Postgres · Microsoft Entra · optional Hermes/Aria inference host
**Date:** 2026-06-27 · **Status:** DRAFT — **not exercised** (no DR test on record; see F-BR-02)

> **Standing caveat (binding):** No production or cloud access was authorized for this audit. Every "expected behaviour" below for Supabase/Vercel/DNS is **documented or vendor-claimed, NOT verified**. Items dependent on infra access are marked **UNKNOWN — blocked on access**. Do not treat this plan as proven until the DR test in §6 is executed and recorded.

---

## 1. Scope & objectives

This plan covers recovery of the Hermes Sourcing production service after a disruptive event: data deletion/corruption, Supabase regional/project failure, Vercel platform/deploy failure, auth/IdP outage, credential compromise, accidental destructive migration, or loss of the source repository.

In scope: the Next.js app (Vercel), the Postgres database of record (Supabase: candidate PII, outreach ledger, suppression list, OAuth mailbox tokens, API-key vault, workspace state), authentication (Supabase Auth + Entra), and the source/IaC (git repo + `supabase/migrations`). Out of scope: third-party email-provider outages (Resend/SendGrid/Gmail/Graph) beyond failover guidance, and the self-hosted Aria/Hermes inference host (B10 — production scope undecided).

---

## 2. Critical assets & dependencies (recovery targets)

| Asset | System of record | Loss = | Recovery source |
|---|---|---|---|
| Candidate PII, outreach history, suppression list, workspace state | Supabase Postgres (`outreach_ledger`, `suppression_list`, `workspace_state`, …) | Reportable data loss + loss of anti-double-contact/anti-ban guarantees | Supabase daily backup + **PITR (if enabled — UNVERIFIED, F-BR-01)** |
| OAuth mailbox tokens | `public.email_connections` (cleartext, F-BR-03) | Mailboxes disconnected; users re-consent | Backup restore (or re-OAuth per seat) |
| Provider API keys | `public.api_keys` (cleartext, F-BR-03) | Outreach/inference broken until re-keyed | Backup restore or re-enter via Settings |
| Auth users/sessions | Supabase `auth.*` + Entra | Users can't sign in | Supabase restore + Entra (external IdP) |
| Application code/config | Vercel deployments + git | Can't redeploy | Vercel prior deployment + git (**no remote today — F-BR-05**) |
| Schema-of-record | `supabase/migrations/0001-0005` | Can't rebuild DB | git repo (off-site this — F-BR-05) |
| Secrets/env | Vercel env vars; `.env.production.example` is the inventory | Service can't start/auth | Secret manager / re-issue from source consoles (`OPERATIONS_RUNBOOK.md §2`) |

Key dependency chain for a full restore: **git (source+migrations) → Supabase (data) → Vercel (env repoint + deploy) → Entra/OAuth (re-consent if tokens lost) → DNS/TLS (Vercel-managed)**.

---

## 3. RTO / RPO — proposed defaults to RATIFY (decision B4)

RTO/RPO are currently **undefined**. The following are **proposed defaults for sign-off**, not commitments. Backup cadence/retention/replication must be sized to whatever is ratified.

| Tier | Component | Proposed RPO | Proposed RTO | Achievable today? |
|---|---|---|---|---|
| T1 | Database (PII, ledger, tokens, keys) | ≤ 5 min (requires **PITR enabled**) | ≤ 1 h | **UNKNOWN** — PITR unverified (F-BR-01); restore untested (F-BR-02) |
| T1 | App (code/config) | 0 (in git) | ≤ 15 min (Vercel rollback) | Plausible, **unverified**; blocked by no remote for rebuild (F-BR-05) |
| T2 | Auth/Entra | Provider-managed | ≤ 4 h | External dependency — UNKNOWN |
| T3 | Source repo | 0 if remote exists | ≤ 1 h | **FAIL today** — no remote (F-BR-05) |

**App-layer RPO caveat:** because state is a single last-write-wins JSONB doc (F-BR-04), the *effective* RPO for a field overwritten by a concurrent user is **immediate and unrecoverable** even with PITR — DR backups do not protect against legitimate overwrites. Fix the concurrency model or accept this explicitly.

---

## 4. DR scenarios & runbooks

For each: trigger → assess → act → verify. All restore-verification uses the **corrected SQL in `BACKUP_RESTORE_REPORT.md §6`** (the existing runbook queries reference non-existent columns — F-BR-07).

### DR-1 — Accidental data deletion / corruption (single workspace or table)
1. **Detect:** user report / outreach_ledger anomaly / monitoring (F-BR-12 gap → may be late).
2. **Contain:** if an active bug is writing bad data, Vercel-rollback the app first (`ROLLBACK_RUNBOOK.md §1`) to stop the bleed.
3. **Recover:** prefer **PITR to a timestamp just before the event** (`ROLLBACK_RUNBOOK.md:184-193`). PITR restores to a **new project** → you must repoint `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in Vercel and redeploy. **This cutover is manual and untested (F-BR-02).**
4. **Verify:** run `BACKUP_RESTORE_REPORT.md §6` checks (8 tables, RLS-on, `claim_and_record` present, suppression consistency, row counts).
5. **RTO/RPO:** target T1; **UNKNOWN** until PITR proven.

### DR-2 — Destructive migration gone wrong
1. **Stop:** halt further deploys.
2. **Decide:** prefer a **forward-fix migration**, not `DROP` (F-BR-08). If schema is incompatible with the code you must run, use PITR to the pre-migration bookmark rather than manual `DROP TABLE` (which erases the immutable audit trail + secrets).
3. **Mandatory pre-step for any future migration:** take a fresh backup / PITR bookmark immediately before applying (add to `DEPLOY_CHECKLIST.md`).
4. **Verify:** as DR-1.

### DR-3 — Supabase project/region failure (region `cdg1` blast radius)
1. **Confirm** via status.supabase.com.
2. **Recover:** restore latest backup/PITR to a **new Supabase project** (different region if regional), repoint Vercel env, redeploy.
3. **Re-establish secrets/tokens:** if `email_connections`/`api_keys` could not be restored intact, re-OAuth each seat and re-enter keys (`OPERATIONS_RUNBOOK.md §2/§3`).
4. **RTO:** dominated by restore time + manual repoint — **UNKNOWN, blocked on access**.

### DR-4 — Vercel platform / bad deploy
1. **Bad deploy:** instant rollback — promote last-good deployment (`ROLLBACK_RUNBOOK.md §1`, ~30-60 s).
2. **Vercel platform outage:** no automatic failover exists. Options: wait (status.vercel.com) or stand up an emergency deploy on an alternate host (Node `next start`, env from `.env.production.example`) — **untested**; capture as a BCP gap (`BUSINESS_CONTINUITY_PLAN.md`).
3. **Verify:** smoke checks (`DEPLOYMENT_RUNBOOK.md §5`): `/login` 200/307, CSP header present, `/api/keys` → 401 unauth canary.

### DR-5 — Auth / Entra IdP outage
1. Confirm scope (Supabase Auth vs Entra). Entra is external — no in-app failover.
2. Demo-mode fallback (`NEXT_PUBLIC_SUPABASE_*` unset) **must NOT** be used as a prod workaround — it disables auth and uses localStorage (B7). Do not flip prod to demo mode.
3. Communicate downtime; wait on IdP recovery.

### DR-6 — Credential / service-role-key compromise
1. **Rotate immediately:** `SUPABASE_SERVICE_ROLE_KEY` (full RLS bypass), then OAuth secrets, provider keys, `HERMES_API_KEY` — per `OPERATIONS_RUNBOOK.md §2c/§2b`.
2. **Assess backup exposure:** because secrets are cleartext in the DB (and thus in backups — F-BR-03), assume any leaked backup leaked all tokens/keys; force re-OAuth + re-key.
3. **Restore** only from a backup predating the compromise if data integrity is in doubt.
4. Trigger incident process (`INCIDENT_RESPONSE_RUNBOOK.md`).

### DR-7 — Loss of source repository / developer machine
1. **Today this is unrecoverable beyond the last manual copy** — no git remote (F-BR-05). The committed migrations ARE the schema-of-record.
2. **Fix before prod:** push to a protected remote (A1); keep an off-site bundle.

---

## 5. Break-glass & access (to define — F-BR-10)

Currently undocumented. Required before prod:

| Control | Required definition |
|---|---|
| Who can restore | Named DR owner + one backup; least-privilege day-to-day, elevated only via break-glass |
| Break-glass creds | Supabase project owner + Vercel admin held in a sealed secret manager entry; access logged + alerted; rotated after use |
| Approval | Restore/PITR requires DR owner + one approver (out-of-band confirmation) |
| Audit | Every break-glass use logged with who/when/why; reviewed post-incident |
| Boundaries | Restore drills go to an **isolated project only** — never the production project (`OPERATIONS_RUNBOOK.md:44`) |

---

## 6. DR test plan (must run to clear F-BR-01/F-BR-02)

| Test | Cadence | Pass criteria | Status |
|---|---|---|---|
| Local restore drill | Per release + monthly | Error-strict (`set -e`, no `|| true` — F-BR-06): 8 public tables, RLS-on all, `claim_and_record` present, row counts match source | **NOT RUN** (Docker unavailable in audit) |
| Prod backup recency check | Weekly (automated) | Latest backup < 25 h old via Supabase Management API → alert on breach | **NOT IMPLEMENTED** (F-BR-12) |
| Prod restore-to-isolated-project drill | Quarterly | Restore latest backup/PITR to a throwaway project; verify per `BACKUP_RESTORE_REPORT.md §6`; measure restore time vs RTO; delete project | **BLOCKED on access** |
| Migration up/down round-trip | Per migration (CI) | Apply + reverse on ephemeral DB with no data loss on the reversible set | **NOT IMPLEMENTED** (F-BR-08) |
| Full DR game-day (DR-1/DR-3 end-to-end) | Annual | Restore + Vercel repoint + smoke pass within RTO; documented | **NEVER DONE** |

Record every run (date, backup timestamp, restore duration, PASS/FAIL, gaps) in the ops log and `EVIDENCE_INDEX.md`.

---

## 7. Post-incident
After any DR invocation: confirm smoke checks (`DEPLOYMENT_RUNBOOK.md §5`), confirm RLS on all tables, confirm no `outreach_ledger` loss (audit-trail integrity), file a postmortem (`INCIDENT_RESPONSE_RUNBOOK.md`), and feed lessons back into this plan + `RISK_REGISTER.md`.

## 8. Open blockers
A1 (remote), A4/A7 (Supabase access), A6 (monitoring), B4 (RTO/RPO), B5 (retention/compliance), B8 (ownership), B10 (Aria scope). Until resolved, **DR is unproven → Gate 12 FAIL**.
