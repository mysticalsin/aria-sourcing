# Business Continuity Plan — Hermes Sourcing (MSourcing)

> SUPERSEDED by `STATUS.md` 2026-07-10 for current release posture. Historical 2026-06-27 evidence may contain stale stack versions, suite counts, migration ranges, and verdicts.


**Gate:** Gate 12 — Backup/DR · **Companion to:** `DISASTER_RECOVERY_PLAN.md`, `BACKUP_RESTORE_REPORT.md`
**Date:** 2026-06-27 · **Status:** DRAFT — **not exercised**; multiple ownership/decision items open (B-series)

> **Caveat:** This BCP is written for the *intended* production deployment. The app is presently an MVP demo with no proven backups, no monitoring, and no off-site source (see `BACKUP_RESTORE_REPORT.md`). Continuity claims below are **plans, not verified capabilities**. Ownership/on-call (B8), RTO/RPO (B4), and compliance scope (B5) are unresolved business decisions.

---

## 1. Purpose & scope

Keep the recruiting operation running (or degrade safely) when Hermes Sourcing or a dependency is impaired, and protect candidate PII, the outreach audit trail, and connected mailboxes throughout. Covers people, process, and the fallbacks that bridge the gap while technical recovery (`DISASTER_RECOVERY_PLAN.md`) runs.

---

## 2. Business impact analysis (BIA)

| Business function | Supported by | Impact if down | Max tolerable outage (proposed — ratify B4) |
|---|---|---|---|
| View/manage candidates & campaigns | App + Supabase `workspace_state` | Recruiters blind to pipeline | 4 h |
| Outreach sending (live seats) | Email providers + `claim_and_record` RPC + ledger | No new outreach; **risk of double-contact/over-cap if dedup state is lost** | 8 h (sending is gated/dry-run by default — degradation is tolerable) |
| Reply handling / classification | App + provider inboxes | Delayed candidate responses | 8 h |
| Auth / access | Supabase Auth + Entra | Total lockout | 4 h |
| Audit trail integrity (`outreach_ledger`) | Supabase (immutable, no client DELETE) | **Compliance + anti-ban guarantee lost** | ~0 — must not be silently lost |

**Most critical to protect:** the `outreach_ledger` (dedup + suppression + audit) and the OAuth/API secret stores. Loss of the ledger removes the anti-double-contact / anti-ban guarantee even if the app is up.

---

## 3. Continuity strategies (bridge while DR runs)

| Disruption | Continuity action | Notes / gaps |
|---|---|---|
| App/Vercel down | Recruiters pause automated outreach; manual work continues in provider inboxes directly. Sending is dry-run-by-default, so a pause is safe. | No alternate live host stood up/tested (BCP gap — see §6). |
| Supabase down/restoring | Freeze writes; **do not** flip to demo mode (would disable auth + use localStorage — B7). Wait for restore (`DISASTER_RECOVERY_PLAN.md DR-1/DR-3`). | During restore, **do not resume sending** until `outreach_ledger` dedup state is confirmed intact, else double-contact risk. |
| Email provider (Resend/SendGrid/Gmail/Graph) outage | Seats auto-stay dry-run / pause on errors; switch to an alternate configured provider if available (Resend↔SendGrid). | Per-seat re-consent may be needed after token issues (`OPERATIONS_RUNBOOK.md §3`). |
| Entra/Auth outage | No in-app fallback; communicate downtime. | External IdP dependency. |
| Credential compromise | Rotate per `OPERATIONS_RUNBOOK.md §2`; force re-OAuth/re-key; assume cleartext backups exposed (F-BR-03). | — |
| Source/dev-machine loss | **No off-site source today (F-BR-05)** — create remote before prod. | Hard blocker. |

**Safe-degradation property worth preserving:** outreach is dry-run by default and only sends on an explicit, gated, verified-domain action (`SUPABASE_SETUP.md`; `tests/guardrails.mts`). This makes "pause everything" a low-risk continuity default.

---

## 4. Roles & responsibilities (TO ASSIGN — B8 / F-BR-10)

| Role | Responsibility | Owner |
|---|---|---|
| DR/BCP owner | Declares incident, authorizes restore/break-glass, owns this plan | **UNASSIGNED** |
| Deputy / on-call | Executes restore + Vercel repoint | **UNASSIGNED** |
| Comms lead | Internal/stakeholder + (if PII breach) regulator/data-subject comms | **UNASSIGNED** |
| DPO / legal | Breach assessment, GDPR erasure-in-backups stance (F-BR-11), retention (B5/B6) | **UNASSIGNED** |
| Platform/Eng | Supabase/Vercel/migrations recovery | **UNASSIGNED** |

A single-person operation today = key-person risk; document at least one backup for each role.

---

## 5. Communications

- **Internal:** team channel — start/stop of incident, scope, ETA (templates in `ROLLBACK_RUNBOOK.md:163-181`).
- **Stakeholders/users:** plain-language status + expected restoration; avoid speculation on data loss until verified.
- **Regulatory/data-subject:** if candidate PII is lost or exposed (e.g. backup leak — F-BR-03), engage DPO; GDPR breach-notification timelines may apply (legal call, not an audit determination — B5).
- **Status sources:** status.supabase.com, status.vercel.com, provider status pages.

---

## 6. Continuity gaps (must close before relying on this BCP)

| Gap | Ref | Blocker |
|---|---|---|
| No proven backup/restore; RTO/RPO undefined | F-BR-01/02/04 | A4/A7, B4 |
| No off-site source backup | F-BR-05 | A1 |
| No monitoring/alerting → late detection widens outage | F-BR-12 / R3 | A6 |
| No tested alternate app host for Vercel-outage continuity | §3 | B1 |
| Roles/on-call unassigned (key-person risk) | F-BR-10 | B8 |
| Cleartext secrets in DB/backups raise breach blast radius | F-BR-03 / R5 | Eng |
| Resume-sending-after-restore guard not codified (double-contact risk) | §3 | Process/Eng |
| GDPR erasure-in-backups undefined | F-BR-11 | B5/B6, legal |

---

## 7. Review & testing
Review this BCP quarterly and after any incident. Validate it in the annual DR game-day (`DISASTER_RECOVERY_PLAN.md §6`). Until that game-day runs and the gaps in §6 close, **business continuity is aspirational, not assured — Gate 12 remains FAIL.**
