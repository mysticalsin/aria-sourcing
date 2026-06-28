# Data Retention & Deletion — Hermes Sourcing (MSourcing)

**Phase:** 5 — Data Protection (companion to `DATA_PROTECTION_REPORT.md`)
**Gate:** Gate 5 — Data Protection
**Date:** 2026-06-27
**Reviewer:** Data Protection Reviewer
**Tree state:** `main`, working tree DIRTY (audited as-is).
**Scope:** retention windows + enforcement, data-subject deletion/erasure (Art.17), subject-access export (Art.15), suppression vs. deletion semantics, immutable audit/ledger retention, and account/workspace removal.
**Baselines:** GDPR Art.5(1)(e) (storage limitation), Art.15/17/20; OWASP ASVS V9; NIST CSF PR.DS; CIS Controls v8 §3.

---

## Exec Summary

The product exposes a complete-looking compliance surface (GDPR mode toggle, retention-day inputs, export/anonymize/suppress actions, "candidates can request data export or erasure at any time"), **but the retention and deletion machinery behind it is incomplete**:

1. **Retention windows are display-only.** `candidateRetentionDays` / `jdRetentionDays` / `emailContentRetentionDays` are stored in settings and shown with the promise *"Records past their retention window are flagged for anonymization,"* yet **no code consumes them** and **no cron/worker exists** to act on them. Effective retention is **indefinite**.
2. **Erasure is partial.** `anonymizeCandidate` masks 6 fields on the active candidate object only; it leaves ~9 other fields plus the separate reply bodies, chat history, agent memory, the audit/activity trail, and the immutable `outreach_ledger` (which retains `candidate_email`). There is **no hard delete** from `workspace_state` or the ledger via the app.
3. **Export under-discloses.** The SAR export returns the `Candidate` object only — not the subject's replies, chats, memory, or ledger rows.
4. **No account/workspace deletion** path exists (only sign-out). `workspace_state` and `outreach_ledger` have no client DELETE policy by design, so even an admin cannot purge a workspace from the app.

These are tracked as findings DP-2, DP-4, DP-5, DP-6, DP-7 in `DATA_PROTECTION_REPORT.md`. **Gate 5 contribution: FAIL.**

---

## 1. Retention — configured vs. enforced

| Setting | Default | Stored at | Enforced? | Evidence |
|---|---|---|---|---|
| `candidateRetentionDays` | 180 | `settings.compliance` (workspace_state) | **NO** | `seed.ts:120`; `compliance-panel.tsx:44`; no consumer (grep) |
| `jdRetentionDays` | 365 | settings | **NO** | `seed.ts:121` |
| `emailContentRetentionDays` | 365 | settings | **NO** | `seed.ts:122` |
| `suppressedUntil` (per candidate) | now+90d | candidate.complianceFlags | partial (read by checks) | `store.ts:1349` |
| `suppression_list.expires_at` | optional | DB | YES (read in `claim_and_record`) | `0002_fleet.sql` RPC |
| Re-contact window | 90d | RPC param | YES | `claim_and_record(p_recontact_days default 90)` |

**Finding:** the only "retention-like" values that are honored are the **suppression / re-contact windows** (which gate *outreach*, not *storage*). The actual **data-retention** windows (how long PII is kept) are inert. The UI text at `compliance-panel.tsx:114-116` is therefore misleading. See DP-2 (HIGH).

**Required to PASS:** a workspace-scoped retention job (Supabase scheduled fn / `pg_cron` / external cron using service-role) that anonymizes or deletes records past each window, writes an audit entry, and is integration-tested — OR, until built, removal of the UI claim.

---

## 2. Data-subject action matrix (current behavior)

| Action | Code | What it does | What it leaves behind |
|---|---|---|---|
| `suppressCandidate` | `store.ts:1339` | stage→Suppressed, `suppressed=true`, `suppressedUntil=+90d` | all PII intact (by design — suppression ≠ deletion) |
| `markDoNotContact` | `store.ts:1358` | `doNotContact=true`, `suppressed=true` | all PII intact |
| `unsubscribeCandidate` | `store.ts:1373` | `unsubscribed=true` | all PII intact |
| `anonymizeCandidate` | `store.ts:1384` | rewrites `name`,`email`,`avatarInitials`,`linkedinUrl`,`githubUrl`,`currentCompany` | `currentTitle`, `location`, `recentActivity`, `techStack`, `yearsExperience`, `outreachHistory`, `replyHistory.excerpt`, `booking`; **plus** `replies[].body`, `chats[]`, `memory[]`, `activities[]` (name in audit — DP-6), and `outreach_ledger.candidate_email` |
| `exportCandidate` | `store.ts:1404` | `JSON.stringify(Candidate)`; sets `gdprExportRequested` | omits `replies[]`, `chats[]`, `memory[]`, ledger rows (DP-5) |
| `recordPiiReveal` | `store.ts:1957` | audit entry "Contact details viewed for {name}" | persists **name** in audit (DP-6) |
| `resetDemo` | `store.ts:2702` | rebuild from synthetic seed (demo only) | overwrites localStorage; not a per-subject erasure |
| (none) | — | **hard delete of a candidate / workspace** | does not exist |

**Suppression vs. deletion:** the suppression model (keep the record, block contact, dedupe via the immutable ledger) is a legitimate-interest design and is internally consistent. The gap is that **deletion/erasure** is presented as available but is not fully implemented.

---

## 3. Immutable audit/ledger retention

- `outreach_ledger` is intentionally append-only from the client: no DELETE policy at the `authenticated` or `anon` level; deletes require the service-role client (`0005_rls_tenant_isolation.sql` §9). It stores `candidate_email`, `candidate_id`, `seat_id`, `campaign_id`, `status`, `at`.
- This is good for audit integrity but means the ledger is a **second copy of candidate email** that the erasure workflow does not reach. An Article-17 request must mask/scrub `candidate_email` in the ledger (retaining a dedupe hash for the legitimate-interest "do not re-contact" guarantee) — this requires a documented service-role routine that does not exist today (DP-4).
- `activities[]` (audit feed) likewise persists candidate names (DP-6) and is not scrubbed by anonymization.

---

## 4. Account / workspace removal

| Capability | Present? | Evidence |
|---|---|---|
| Operator sign-out | YES | `auth/signout/route.ts`, `workspace.ts:78` |
| Delete operator account (profile) | **NO** | no route; profile delete only via `auth.users` cascade (`0001:24`), no app trigger/UI |
| Delete / purge workspace data | **NO** | `workspace_state` & `outreach_ledger` have no client DELETE policy (`0005` §6/§9) |
| Revoke connected mailbox tokens on offboarding | **NO** (no flow) | `email_connections` delete is admin-only DML but no UI/runbook; provider-side token revocation not implemented |

**Finding DP-7 (MEDIUM):** no self-service account or workspace deletion. Offboarding leaves candidate PII, operator PII, and **live OAuth mailbox tokens** in place. Add an admin-gated, service-role workspace-teardown routine (purge `workspace_state`, scrub ledger PII, delete `email_connections` **with provider-side token revocation**, cascade profile deletion) and document the runbook in `OPERATIONS_RUNBOOK.md`.

---

## 5. Required deletion/erasure runbook (TO BUILD — not yet implemented)

This is the target design; none of it is wired today. Until built, erasure requests cannot be fully satisfied.

1. **Locate** the subject: candidate id + email across `workspace_state` (`candidates`, `replies`, `chats`, `memory`, `activities`) and `outreach_ledger`.
2. **Scrub candidate record:** all PII fields (extend `anonymizeCandidate` to cover title/location/recentActivity/techStack/experience/outreach+reply history/booking).
3. **Scrub related content:** delete/redact `replies[].body` for the subject; redact name/email references in `chats[]`, `memory[]`, `activities[]`.
4. **Ledger:** service-role routine masks `candidate_email` (keep a salted dedupe hash so the no-re-contact guarantee survives).
5. **Tokens:** if the subject is also an operator, revoke and delete `email_connections` rows (provider-side revoke first).
6. **Audit:** write a single erasure record (by id/hash, no name) and a deletion certificate for the DSAR file.
7. **Verify:** automated post-check asserting the subject's name/email no longer appears in any store array or the ledger.

---

## 6. Gate 5 (retention & deletion sub-verdict)

**FAIL.** Open: DP-2 (retention unenforced, HIGH), DP-4 (erasure incomplete, MEDIUM), DP-5 (export incomplete, MEDIUM), DP-6 (audit retains PII, MEDIUM), DP-7 (no account/workspace deletion, MEDIUM). Suppression/re-contact windows are correctly enforced; storage-retention and erasure are not.

**Cross-reference:** `DATA_PROTECTION_REPORT.md` (full findings DP-1..DP-11), `DATA_FLOW.md` ("Data Lifecycle and Deletion" — this file supersedes its single-line "Gap" with the full matrix).
