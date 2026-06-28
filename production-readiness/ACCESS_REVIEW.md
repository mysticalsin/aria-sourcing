# Access Review (Admin / Support / Audit Logging) — Hermes Sourcing (MSourcing)

**Phase:** 13 — Privacy / Compliance / Governance
**Gate:** Gate 13 — Privacy / compliance
**Date:** 2026-06-27
**Reviewer:** Privacy / Compliance Reviewer
**Tree state:** `main`, working tree DIRTY (audited as-is).
**Scope:** who can access candidate PII / secrets / mailboxes, the application RBAC model, the per-tenant access boundary, the privileged (service-role) access path, admin/support/provider-plane access, joiner-mover-leaver (JML) & access-recertification, and **audit-logging integrity** for sensitive actions (access to PII, secret reads, admin actions). Companion to `IAM_REVIEW.md` (Phase-6 IAM, which owns secrets-at-rest + provider-plane IAM); this file is the **governance/least-privilege/audit** lens.
**Baselines:** OWASP ASVS V1/V4 (access control), GDPR Art. 5(1)(f)/25/32, NIST CSF PR.AA/PR.PS/DE, CIS Controls v8 §5 (Account Mgmt) + §6 (Access Control Mgmt) + §8 (Audit Log Mgmt).

---

## Exec Summary

The **application-layer access model is genuinely strong for an MVP**: a three-role RBAC (`admin`/`member`/`viewer`) with 14 permissions (`src/lib/rbac.ts`), server-side enforcement (`requireAdmin`, `can()`), RLS that scopes every table to `current_workspace_id()`, column-level grants that withhold `api_keys.secret` and `email_connections` tokens from the `authenticated` role, and profile policies that make role + workspace **immutable from the client** (no self-promotion, no tenant-hop) — `0005_rls_tenant_isolation.sql`. These are real, verified controls and should be preserved.

The **access-governance gaps** are about (1) the **access boundary granularity**, (2) the **privileged path**, (3) **audit integrity**, and (4) **process**:

- **Over-broad internal access by default (HIGH, ACC-1).** Tenancy is **per-email-domain**: a single `workspace_state` blob holds the entire candidate graph and **every authenticated user of the domain can read all of it** (full PII, reply bodies, chats, agent memory). There is no per-recruiter / per-campaign need-to-know segregation, and confidentiality masking is off by default (DP-10). One compromised or curious member sees everything.
- **Broad standing privilege via service-role (HIGH, ACC-2).** The `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS and is the access path to **all** secrets, OAuth tokens, and PII across tenants; its use is not separately logged/alerted, there is no break-glass procedure, and it is also present on a dev laptop (`IAM_REVIEW` LOW). 
- **No admin-bootstrap / JML / recertification process (MEDIUM, ACC-5).** Profiles self-insert pinned to `role='member'` and cannot self-promote; **there is no in-repo path to become `admin`** — promotion requires undocumented manual service-role DML. So admin assignment, support access, offboarding, and periodic access recertification are entirely undocumented/manual.
- **Audit logging is not trustworthy for compliance (MEDIUM, ACC-4).** The `activities[]` "audit trail" lives **inside the client-writable `workspace_state` blob** (any member can update it via the `members update state` RLS policy), so it is **mutable and not tamper-evident**; it is wiped/overwritten by `resetDemo` and not scrubbed by anonymize (it even stores candidate names — DP-6). The `crmAuditLogs` toggle that purports to control it is **inert** (PRIV-2). DB-layer access (service-role reads of secrets/PII) is **not** logged in any repo-visible sink, and there is no monitoring/log-aggregation (`INVENTORY §7`). The only immutable trail is `outreach_ledger` (send events), which is narrow.
- **Provider-plane access UNKNOWN (blocked).** Vercel team roles, Supabase dashboard access + MFA, who holds the service-role key, and the OAuth-app admins are not reviewable from the repo (`IAM_REVIEW` UNKNOWN).

**Gate 13 (access component): FAIL** — open HIGH (ACC-1 over-broad PII access; ACC-2 unmonitored standing privilege), open MEDIUM (ACC-4 audit integrity; ACC-5 no JML/recertification), and the provider-plane access review is **UNKNOWN — blocked on access**.

---

## 1. Application RBAC (verified — preserve)

| Control | Evidence | Verdict |
|---|---|---|
| 3 roles, 14 permissions | `src/lib/rbac.ts:11-33` | PASS |
| `member` cannot manage keys/roles/fleet/settings/providers | `rbac.ts:31` (no `manage_*`) | PASS |
| Server-side `requireAdmin` on mutating routes | `supabase/server.ts:18-36`; keys/keys-test/google/microsoft callbacks | PASS |
| RLS scopes all tables to own workspace | `0005` §4-11 (`current_workspace_id()`) | PASS |
| Admin-only writes for fleet/keys/connections/suppression | `0005` §7-11 (`current_profile_role()='admin'`) | PASS |
| `secret` / OAuth tokens withheld from `authenticated` | `0005:74-81` column grants | PASS |
| No self-promotion / tenant-hop | `0005:129-150` (insert pins role='member'; update pins role+workspace) | PASS |
| Least-privilege OAuth scopes | `auth/google:37` (`gmail.send`), `auth/microsoft:38-39` | PASS |

`compliance` permission is held by `admin` + `member` (`rbac.ts:31`) — i.e. members can run export/anonymize/suppress. Acceptable for recruiters, but combined with ACC-1 it means any member can both view all PII and exercise rights actions on it.

---

## 2. Who can access what (access matrix — PII & secrets)

| Principal | Candidate PII (all) | Reply bodies / chats / memory | `api_keys.secret` | OAuth tokens | Cross-tenant |
|---|---|---|---|---|---|
| `viewer` | read (full, masking off by default) | read | no | no | no (RLS) |
| `member` | read + rights-actions | read | no | no | no (RLS) |
| `admin` | read + manage | read | no (metadata only via client) | no (metadata only) | no (RLS) |
| **service-role** (server) | **read/write ALL tenants** | all | **plaintext** | **plaintext** | **YES (bypasses RLS)** |
| Supabase/Vercel platform staff | via DB/logs (UNKNOWN controls) | via DB | plaintext (DP-1) | plaintext (DP-1) | platform-level |

The critical rows: **every domain member reads the full PII graph (ACC-1)**, and the **service-role is an all-tenant plaintext superuser (ACC-2)** whose use is unmonitored.

---

## Findings (FINDING FORMAT)

## [HIGH] ACC-1 — Over-broad internal access: every domain member can read all candidate PII (no need-to-know segregation)
- **Area / Affected:** Per-email-domain tenancy; single `workspace_state` blob (`0001`/`0005` §6 `members read state`); masking off by default (DP-10); `DATA_FLOW.md` note "all PII is visible to every authenticated user of that domain".
- **Description:** The workspace = the email domain, and all candidate data (PII, verbatim reply bodies incl. possible Art. 9 data, chats, agent memory) lives in one document that every `member`/`viewer` of that domain can read in full. There is no per-recruiter, per-campaign, or per-requisition access partition, and confidentiality masking is opt-in/render-only. This violates data-minimization-at-access / least-privilege (GDPR Art. 5(1)(f)/25(2), CIS §6).
- **Impact:** A single compromised, curious, or departing member can read every candidate's full record; insider-risk blast radius = entire workspace; no need-to-know.
- **Likelihood:** High (default behavior).
- **Reproduction:** Sign in as any member → read full candidate graph, reply bodies, chats.
- **Evidence:** `0005` §6; `DATA_FLOW.md` lines 11-13; DP-10.
- **Recommended fix:** Add need-to-know segregation (per-recruiter/per-campaign visibility), default confidentiality masking on for non-owners, and consider splitting the monolithic blob so RLS can scope by assignment; log PII reveals to an immutable sink (ACC-4).
- **Tests to add:** Test that a member not assigned to a campaign cannot read its candidates; default-masking test.
- **Status:** OPEN. **Owner:** Eng + DPO. **Residual risk:** Medium after segregation.

## [HIGH] ACC-2 — Service-role is an unmonitored, all-tenant plaintext superuser with no break-glass control
- **Area / Affected:** `SUPABASE_SERVICE_ROLE_KEY` (`supabase/config.ts:16`, `server.ts:42-47`); used by keys/keys-test/hermes-chat/OAuth-callbacks; reads plaintext secrets/tokens/PII across tenants (RLS bypass). Overlaps `IAM_REVIEW` HIGH (secrets-at-rest) but framed here as **access governance**.
- **Description:** The service-role key bypasses RLS and can read/write **every tenant's** PII, secrets (DP-1 plaintext), and OAuth tokens. Its use is **not separately logged or alerted**, there is **no break-glass / just-in-time** procedure, no monitoring (`INVENTORY §7`), and the key is broadly used across serverless routes and also sits on a dev laptop (`IAM_REVIEW` LOW). A leak or misuse is both high-impact and **undetectable** with current tooling.
- **Impact:** Cross-tenant data exposure path with no detection; the single most powerful credential is unmonitored.
- **Likelihood:** Medium (requires key access) but maximal blast radius.
- **Reproduction:** With the service-role key, query any tenant's `workspace_state`/`api_keys`/`email_connections`.
- **Evidence:** `config.ts:16`; `server.ts:42-47`; `INVENTORY §7` (no monitoring); `IAM_REVIEW` LOW.
- **Recommended fix:** Minimize service-role usage; log every service-role read of secrets/PII to an immutable sink with alerting; rotate the key + remove from laptops; add a break-glass procedure; consider per-purpose scoped service identities.
- **Tests to add:** Test that service-role secret reads emit an audit record; lint that service-role client is never imported client-side (already partially asserted in `security-audit.mts`).
- **Status:** OPEN. **Owner:** Tony / platform. **Residual risk:** Medium after monitoring + rotation.

## [HIGH/UNKNOWN] ACC-3 — Provider-plane access (Vercel/Supabase/OAuth apps) not reviewable; no evidence of MFA / least-privilege / audit
- **Area / Affected:** Vercel team roles + env-var access + deployment protection + audit log; Supabase dashboard access + MFA + who holds service-role; Google/Azure OAuth-app admins. All UNKNOWN from repo (mirrors `IAM_REVIEW` UNKNOWN block).
- **Description:** Cannot verify who can read production env vars/secrets, who can query the prod DB via the dashboard, whether MFA is enforced, whether there is an access audit log, or who administers the OAuth apps. These are the highest-trust accounts for PII/secret access.
- **Impact:** Unknown human access to all PII/secrets; potentially excessive standing access with no audit.
- **Likelihood:** Unknown.
- **Access/decision needed:** Read-only access (or written attestation) for Vercel project settings + audit log, Supabase project members + MFA + dashboard access, and the Google/Azure app-registration admins.
- **Evidence:** `IAM_REVIEW.md` "UNKNOWN — provider-plane IAM".
- **Recommended fix:** Enforce SSO+MFA on all platform consoles, least-privilege team roles, enable audit logs, restrict env-var/secret read to a minimal set, and document the access list.
- **Status:** UNKNOWN — blocked on access. **Owner:** Tony / platform. **Residual risk:** High until evidenced.

## [MEDIUM] ACC-4 — Audit logging is not tamper-evident, is client-mutable, and omits sensitive access; `crmAuditLogs` toggle is inert
- **Area / Affected:** `activities[]` inside `workspace_state` (member-writable via `0005` §6 `members update state`); `recordPiiReveal` writes candidate **name** into it (`store.ts:1957`, DP-6); `resetDemo` overwrites it; `crmAuditLogs` toggle inert (PRIV-2); no DB-layer access logging; no monitoring (`INVENTORY §7`). Only `outreach_ledger` is immutable (send events only).
- **Description:** The compliance/audit trail the product advertises ("immutable audit trail" in the panel description) is stored in a blob that any member can rewrite, is not append-only, is not tamper-evident, embeds PII (defeating anonymization — DP-6), and does not capture the most security-relevant events (secret reads, service-role access, admin role changes, cross-tenant access). The toggle that claims to govern it does nothing.
- **Impact:** Cannot prove who accessed/changed what; fails accountability (Art. 5(2)) and breach-investigation needs; CIS §8 not met.
- **Likelihood:** High (it is the current design).
- **Reproduction:** As a member, update `workspace_state` to alter `activities[]`; `crmAuditLogs` off changes nothing.
- **Evidence:** `0005` §6; `store.ts:1957`; DP-6; PRIV-2; `INVENTORY §7`.
- **Recommended fix:** Move the audit trail to an append-only, server-written sink (separate table with no client UPDATE/DELETE, or external log store with integrity), capture sensitive-access events (PII reveal, secret/service-role reads, role changes, exports, erasures), log by candidate **id**/salted hash not name (DP-6), wire `crmAuditLogs` to actually toggle the sink, and ship logs to monitoring/alerting.
- **Tests to add:** Test that the audit sink rejects client UPDATE/DELETE; test that a PII reveal / secret read emits a record; test audit notes contain no candidate name.
- **Status:** OPEN. **Owner:** Eng + Compliance. **Residual risk:** Low-Medium after immutable sink.

## [MEDIUM] ACC-5 — No admin-bootstrap, JML, or access-recertification process; admin promotion is undocumented manual DML
- **Area / Affected:** Profile insert pins `role='member'` and update pins role (`0005:129-150`); **no in-repo path to `admin`** (grep: no `make_admin`/bootstrap-to-admin in migrations); no offboarding/recertification artifact.
- **Description:** Because clients cannot self-promote, becoming an `admin` requires a **manual service-role DB update** that is **undocumented**. There is no joiner-mover-leaver process, no periodic access recertification, no offboarding runbook (which must also revoke OAuth mailbox tokens — DP-7), and no record of who is admin in which workspace.
- **Impact:** Ad-hoc/undocumented privilege grants; stale access on departures; live OAuth tokens left behind at offboarding (DP-7); no recertification evidence (CIS §5/§6).
- **Likelihood:** Medium (every onboarding/offboarding/role change).
- **Reproduction:** Create a workspace → all users are `member`; no UI/route promotes to admin; only manual DML.
- **Evidence:** `0005:129-150`; migration grep (no admin bootstrap); DP-7.
- **Recommended fix:** Define and document admin bootstrap (first verified user or explicit grant), a JML process (provision/de-provision incl. token revocation), an admin UI for role assignment with audit (ACC-4), and quarterly access recertification (`mantu-it-onboarding`/`mantu-it-offboarding`).
- **Status:** OPEN. **Owner:** Tony / Ops + Eng. **Residual risk:** Low-Medium.

---

## Gate 13 (access component) verdict: **FAIL**
Open HIGH: ACC-1 (over-broad PII access), ACC-2 (unmonitored service-role superuser). Open MEDIUM: ACC-4 (audit integrity), ACC-5 (no JML/recertification). ACC-3 (provider-plane access) UNKNOWN — blocked on access. App-layer RBAC/RLS primitives are strong and must be preserved.

## Blocked / UNKNOWN (need access)
- Vercel/Supabase/OAuth-app access lists + MFA + audit logs (ACC-3).
- Confirmation of who holds the service-role key and its rotation history (ACC-2, `IAM_REVIEW`).

## Cross-references
- `IAM_REVIEW.md` (Phase-6 IAM — secrets-at-rest, OAuth, provider-plane); `AUTHORIZATION_MATRIX.md` (full permission matrix); `DATA_PROTECTION_REPORT.md` DP-1/DP-6/DP-7; `PRIVACY_REVIEW.md` PRIV-2/PRIV-10; `INVENTORY.md §5/§7`.
