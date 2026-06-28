# Data Protection Report — Hermes Sourcing (MSourcing)

**Phase:** 5 — Data Protection
**Gate:** Gate 5 — Data Protection
**Date:** 2026-06-27
**Reviewer:** Data Protection Reviewer (production-readiness review)
**Tree state:** git branch `main`, **WORKING TREE DIRTY** (audited as-is; ~50 modified files staged/unstaged per `git status`). Evidence cites the current on-disk tree.
**Scope:** data classification, encryption (at rest / in transit), secrets-manager / KMS usage, password storage, PII minimization & masking, log redaction (logs / client bundle / repo), and the data export / deletion / retention / account-removal workflows (the latter detailed in the companion file `DATA_RETENTION_AND_DELETION.md`).
**Baselines:** OWASP ASVS V6 (Stored Cryptography) / V7 (Errors & Logging) / V9 (Data Protection) — L2 min, L3 for sensitive-data parts; OWASP API Security Top-10 (API3 BOPLA, API8 Security Misconfiguration); OWASP Top-10 A02 (Cryptographic Failures) / A09 (Logging Failures); NIST SSDF PW.* / NIST CSF PR.DS; CIS Controls v8 §3 (Data Protection).

---

## Exec Summary

MSourcing has a **deliberate, well-documented secrets-handling posture for the read path** — provider API secrets and OAuth tokens are withheld from the browser by column-level Postgres grants, resolved server-side only via the service-role client, and never echoed in API responses (verified: `0003_api_keys.sql`, `keys/test/route.ts`, `hermes/chat/route.ts:88-110`; `security-audit.mts` asserts no raw secret return and no hardcoded keys). The service-role key is server-only (no `NEXT_PUBLIC_` prefix — `supabase/config.ts:16`). Render-time PII masking exists and is tested (42/42 `rules-confidential.mts`).

However, **the storage and lifecycle layers are not production-grade for real candidate PII.** Three HIGH issues remain open: (1) provider API keys **and** Gmail/Microsoft OAuth access+refresh tokens are stored as **plaintext columns** with **no KMS / envelope encryption** — `pgcrypto` is installed but unused on these columns, so any DB dump, backup leak, or service-role compromise yields full cleartext; (2) the **data-retention windows shown in the UI are never enforced** — the settings exist and claim "Records past their retention window are flagged for anonymization," but no code consumes them and no cron worker exists, so candidate PII and email content are retained **indefinitely**; (3) **candidate email is written to logs in plaintext** with no redaction layer. In addition, the GDPR **erasure and subject-access workflows are incomplete** (anonymization masks only 5 of ~15 PII fields in the active blob and leaves the reply bodies, chat history, agent memory, audit trail, and the immutable ledger intact), and there is **no account / workspace deletion** path. Encryption-at-rest of the Supabase database itself is **UNKNOWN — blocked on infra access**.

**Gate 5 verdict: FAIL.** Multiple HIGH issues open (plaintext secrets/tokens at rest, retention unenforced, PII in logs) plus MEDIUM erasure/export/account-removal gaps; encryption-at-rest is UNKNOWN. This is consistent with the app's own "MVP demo, mock integrations, synthetic data" self-description — but the live (Supabase) path wires **real** OAuth mailbox tokens, real provider keys, and real candidate PII, so these controls must be closed before any real-user / real-PII deployment.

---

## Gate 5 Decision

| Check | Result | Evidence |
|---|---|---|
| Data classification documented | PASS | `DATA_FLOW.md` PII table; this report §"Data Classification" |
| Encryption in transit | PASS | All upstreams HTTPS (`providers.ts`, `email-oauth.ts:108,139`, Supabase URL https in prod; cloud LLM `provider.ts`); Vercel TLS termination |
| Encryption at rest — application/sensitive columns | **FAIL** | `0003`/`0004` store `secret`/`access_token`/`refresh_token` as plaintext `text`; `pgcrypto` installed (`0001_init.sql:8`) but unused on them — Finding DP-1 |
| Encryption at rest — managed DB / disk | **UNKNOWN — blocked on access** | No infra/Supabase project access; cannot verify Supabase at-rest encryption, backup encryption, or KMS config |
| Secrets manager / KMS | **FAIL** | All secrets are plain env vars or plaintext DB columns; no Vault/pgsodium/KMS reference anywhere (`.env.production.example`, migrations) — DP-1, DP-9 |
| Secrets withheld from client (read path) | PASS | Column grants `0003:24-26`,`0004:26-28`; `config.ts:16` server-only; `keys/route.ts` returns `last4` only; `security-audit.mts:47-52` |
| Password storage | PASS (N/A custom) | No custom password handling; auth via Supabase OAuth/SSR (`supabase/server.ts`). Supabase-side credential hashing UNKNOWN-but-standard, no repo evidence |
| PII minimization & masking | PARTIAL / MEDIUM | Render-only masking tested (`rules-confidential.mts` 42/0) but off by default, reversible hints, storage unmasked — DP-10 |
| Log redaction (no secrets/PII in logs) | **FAIL** | Candidate email logged plaintext (`providers.ts:77,82,99,102,108`) — DP-3. (Positive: chat proxy does NOT log prompt content — `hermes/chat/route.ts:140`) |
| Secrets in repo / client bundle | PASS (LOW note) | No hardcoded secrets (`security-audit.mts:46-49`, gitleaks in CI `ci.yml:42`); `.env.local` holds only published Supabase **demo** keys (`iss:supabase-demo`, `127.0.0.1:54321`) and is gitignored (`.gitignore` `.env*.local`) — DP-11 |
| Data export (SAR / Article 15) | MEDIUM | `exportCandidate` serializes Candidate only; omits replies/chats/memory/ledger — DP-5 |
| Data deletion / erasure (Article 17) | **FAIL** | No hard delete; anonymization partial; ledger/audit/replies retain PII — DP-4, DP-6 |
| Data retention enforcement | **FAIL** | Retention settings unenforced (no consumer, no cron) — DP-2 |
| Account / workspace removal | **FAIL** | No self-service account or workspace deletion path — DP-7 |

**Overall Gate 5: FAIL** (open HIGH: DP-1, DP-2, DP-3; open MEDIUM: DP-4, DP-5, DP-6, DP-7, DP-8, DP-9; encryption-at-rest UNKNOWN — blocked on infra access).

---

## Data Classification

| Class | Examples (fields / tables) | Where it lives | Sensitivity |
|---|---|---|---|
| **Secrets / credentials** | `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_SECRET`, `RESEND_API_KEY`, `SENDGRID_API_KEY`, `HERMES_API_KEY` (env); `api_keys.secret`, `email_connections.access_token`/`refresh_token` (DB) | env vars + Postgres (plaintext) | **CRITICAL** — keys to provider accounts & customer mailboxes |
| **Candidate PII (identity/contact)** | `name`, `email`, `linkedinUrl`, `githubUrl`, `currentCompany`, `currentTitle`, `location`, `avatarInitials` (`types.ts:258-296`) | `workspace_state` JSONB / localStorage; `outreach_ledger.candidate_email` | HIGH |
| **Candidate-authored free text** | `ClassifiedReply.body` (full reply, `types.ts:316`), `replyHistory.excerpt`; may contain special-category data (health, etc.) | `workspace_state` JSONB / localStorage | HIGH (potential Art.9) |
| **Communication content** | `OutreachMessage.subject`/`body`, chat threads (`ChatThread.messages`), agent `memory` | `workspace_state` JSONB / localStorage | MEDIUM-HIGH |
| **Operator / recruiter PII** | `profiles.email`/`full_name`, `agent_seats.operator_email`, `api_keys.created_by` | Postgres | MEDIUM |
| **Behavioral / derived** | `recentActivity`, `techStack`, `matchScore`, `lastContactedAt`, `booking` | `workspace_state` JSONB / localStorage | MEDIUM |

There is no data-classification policy artifact in-repo (labels, handling rules per class). Recommend codifying the table above as the authoritative classification and tagging fields accordingly.

---

## Secrets Inventory & Handling (verified)

| Secret | Storage | Returned to browser? | Encryption at rest | Rotation |
|---|---|---|---|---|
| Supabase service-role key | env `SUPABASE_SERVICE_ROLE_KEY` | No (`config.ts:16` server-only) | platform env (UNKNOWN) | none documented |
| Google/Microsoft OAuth app secrets | env | No | platform env (UNKNOWN) | none documented |
| Resend / SendGrid keys | env (or `api_keys` vault) | No | env (UNKNOWN) / **plaintext DB** | none documented |
| Hermes API key | env or `api_keys` vault by id | No (`hermes/chat/route.ts:88-110`) | env / **plaintext DB** | none documented |
| Per-workspace provider keys | `api_keys.secret` (DB) | No (column grant `0003:24`) | **PLAINTEXT** | manual delete only |
| Gmail / Graph mailbox tokens | `email_connections.access_token`/`refresh_token` | No (column grant `0004:26`) | **PLAINTEXT** | OAuth refresh; no encryption |

Positive controls confirmed: service-role client is server-only and never imported into client code (`grep SERVICE_ROLE` → only `config.ts` + `server.ts`); `resolveVaultSecret()` verifies `workspace_id` before returning a secret and never logs it (`hermes/chat/route.ts:96-110`); secret never appears in any API response body.

---

## Findings (FINDING FORMAT)

## [HIGH] DP-1 — Provider API keys and OAuth mailbox tokens stored in plaintext at rest (no KMS / envelope encryption)
- **Area:** Stored cryptography / secret management (OWASP A02, ASVS V6, API8, CIS §3.11)
- **Affected:** `supabase/migrations/0003_api_keys.sql:18` (`secret text not null`); `supabase/migrations/0004_email_connections.sql:14-16` (`access_token text not null`, `refresh_token text`); writers `src/app/api/keys/route.ts:48-51`, `src/app/auth/google/callback/route.ts:105-116`, `src/app/auth/microsoft/callback/route.ts:~105-116`, `src/app/api/outreach/send/route.ts:166-169`.
- **Description:** Per-workspace provider API secrets and **live Gmail/Microsoft Graph access + refresh tokens** are persisted as cleartext `text` columns. `pgcrypto` is enabled (`0001_init.sql:8`) but is **not used** for these columns; there is no `pgsodium`, Supabase Vault, application-layer envelope encryption, or KMS anywhere in the repo. Column-level grants + RLS hide the columns from the `authenticated` role, but that is an access-control, not an encryption, control.
- **Impact:** A database dump/export, a backup leak, or a **service-role key compromise** yields cleartext provider keys (charge/abuse the customer's LLM/email accounts) and cleartext OAuth tokens (read/send mail **as the customer** from connected mailboxes). This is the highest-blast-radius data-protection gap. CRITICAL conditional on service-role/backup exposure.
- **Likelihood:** Medium (service-role keys are widely shared with serverless; backups are routinely exported).
- **Reproduction:** Inspect schema; `select id, secret from api_keys` / `select access_token, refresh_token from email_connections` via the service-role client returns cleartext.
- **Evidence:** `0003_api_keys.sql:18`; `0004_email_connections.sql:14-16`; `grep -rn pgsodium|vault|encrypt src/ supabase/` → no hits on these columns.
- **Recommended fix:** Encrypt at rest with Supabase Vault / `pgsodium` (column encryption) **or** application-layer envelope encryption with a DEK wrapped by a KMS-held KEK (AWS KMS / GCP KMS / Vault Transit); store only ciphertext + key-id. Alternatively store only opaque references in a dedicated secret manager. Rotate all currently-stored secrets on cutover and any suspected exposure.
- **Tests to add:** Migration/integration test asserting the columns contain ciphertext and that a raw `select` cannot recover the plaintext; round-trip encrypt/decrypt test.
- **Status:** OPEN (supersedes prior SECURITY_REVIEW G-5 and RISK_REGISTER R5b — unchanged, still open).
- **Owner:** Eng (data) + Tony (KMS decision).
- **Residual risk after fix:** LOW.

## [HIGH] DP-2 — Data-retention windows are configured in the UI but never enforced ("retention theater")
- **Area:** Data minimization / retention (GDPR Art.5(1)(e), ASVS V9, NIST CSF PR.DS, CIS §3.1)
- **Affected:** `src/components/settings/compliance-panel.tsx:43-46,114-116`; settings type `src/lib/types.ts:504-506`; defaults `src/lib/seed.ts:120-122`, `src/lib/store.ts:2884`. **No consumer** of these values exists.
- **Description:** The Compliance panel exposes `candidateRetentionDays` (default 180), `jdRetentionDays` (365), `emailContentRetentionDays` (365) and tells the operator: *"Records past their retention window are flagged for anonymization. Candidates can request data export or erasure at any time."* A repo-wide search shows these keys are only **written** (seed/defaults) and **read by the panel itself** — no scheduler, worker, RPC, or store action ever acts on them. The Schedules panel confirms there is no live runner: *"Until that's wired, schedules stay configured"* (`schedules-panel.tsx:64`). Result: candidate PII, JDs, and email content are retained **indefinitely**, directly contradicting the displayed control.
- **Impact:** Storage-limitation violation; indefinite retention of HIGH-class PII and candidate-authored content; a misleading compliance assurance shown to operators (and, by implication, to data subjects).
- **Likelihood:** High (it is the default behavior — the control does nothing).
- **Reproduction:** `grep -rn "candidateRetentionDays|jdRetentionDays|emailContentRetentionDays" src/` → only definitions/defaults + the panel; no enforcement path.
- **Evidence:** command output above; `compliance-panel.tsx:114-116`.
- **Recommended fix:** Implement a server-side retention job (Supabase scheduled function / `pg_cron` / external cron with service-role) that, per workspace, anonymizes or hard-deletes candidate records, JDs, replies, chats, and email content older than the configured window; log each action to the audit trail; until built, **remove the UI claim** so it is not misleading.
- **Tests to add:** Integration test seeding records past the window and asserting they are anonymized/deleted on the job run; test that the job is workspace-scoped.
- **Status:** OPEN (NEW — not in prior docs).
- **Owner:** Eng (data) + Compliance.
- **Residual risk after fix:** LOW.

## [HIGH] DP-3 — Candidate PII (email) written to application logs without redaction
- **Area:** Logging (OWASP A09, ASVS V7, GDPR data minimization)
- **Affected:** `src/lib/providers.ts:77` (`auditLog("info","Send attempt",{ ... to: req.to })`), `:82,:99,:102,:108` (`{ to: req.to }`); these structured logs go to `console.log`/`console.error` → Vercel function logs.
- **Description:** The email-provider audit logger records the candidate recipient email (`to`) in plaintext on every send attempt, dry-run, success, and failure. There is no field-level redaction / hashing and no PII-aware log pipeline. If logs ship to a third-party aggregator, candidate emails are visible to platform/log staff with no lawful-basis control.
- **Impact:** PII exposure to log-platform personnel; data-minimization breach; expands the data-subject footprint to log retention systems not covered by the erasure workflow.
- **Likelihood:** High in production (logging is on by default).
- **Reproduction:** Trigger any send/dry-run; inspect function logs — recipient email present in cleartext.
- **Evidence:** `providers.ts:77,82,99,102,108`.
- **Note (positive):** The Aria/cloud LLM proxy was checked and **does not** log prompt content — it logs only `{ task, stream, model }` / `{ provider, status }` (`hermes/chat/route.ts:140,158,...`); `keys/route.ts` logs only `{ message, code }`. So the leak is scoped to the email provider audit log.
- **Recommended fix:** Centralize a redaction helper (mask local-part / hash email with a per-deployment salt); apply to all `to`/`from`/`account_email` fields before logging; document log retention + access controls and exclude PII fields from structured logs.
- **Tests to add:** Unit test asserting the log entry for a send contains no raw email; lint rule forbidding raw PII fields in `auditLog`/`logUpstream` metadata.
- **Status:** OPEN (supersedes RISK_REGISTER R9 — still open).
- **Owner:** Eng (platform/observability).
- **Residual risk after fix:** LOW.

## [MEDIUM] DP-4 — Right-to-erasure (Art.17) is incomplete; anonymization is partial and the ledger/replies/chats/memory retain PII
- **Area:** Data subject rights / deletion (GDPR Art.17, ASVS V9)
- **Affected:** `src/lib/store.ts:1384-1402` (`anonymizeCandidate`); no hard-delete action exists; `outreach_ledger` has no client DELETE policy (`0005` §9) and retains `candidate_email`; `replies[]` (`ClassifiedReply.body`), `chats[]`, `memory[]` are untouched.
- **Description:** `anonymizeCandidate` rewrites only `name`, `email`, `avatarInitials`, `linkedinUrl`, `githubUrl`, `currentCompany` in the active candidate object. It leaves on the same record: `currentTitle`, `location`, `recentActivity`, `techStack`, `yearsExperience`, `outreachHistory`, `replyHistory.excerpt`, `booking`. It does **not** touch the separate `replies[]` array (full candidate reply bodies), `chats[]` (which may reference the candidate), `memory[]`, or the `outreach_ledger` rows (which retain `candidate_email`). There is no hard delete from `workspace_state` or the ledger. A complete erasure request therefore cannot be satisfied by the product.
- **Impact:** Residual identifiable / re-identifiable data persists after an "anonymize" action; non-compliant erasure; the ledger `candidate_email` alone re-identifies the subject.
- **Likelihood:** High when an erasure request is actually exercised.
- **Reproduction:** Anonymize a candidate; inspect the persisted `workspace_state` JSON — `replies[].body`, ledger `candidate_email`, `recentActivity`, and the audit activity (DP-6) still identify the person.
- **Evidence:** `store.ts:1384-1402`; `0002_fleet.sql` ledger schema; `0005` §9 (no DELETE policy); `types.ts:316` (`ClassifiedReply.body`).
- **Recommended fix:** Implement a true erasure path: scrub all PII fields on the candidate, delete/scrub matching `replies[]`, redact candidate references in `chats[]`/`memory[]`/`activities[]`, and a service-role routine to mask `candidate_email` in the immutable ledger (keep the dedupe hash, drop the address). Document what is retained for legitimate-interest (suppression) and why.
- **Tests to add:** Test that after erasure no field across candidates/replies/chats/memory/ledger contains the subject's name or email.
- **Status:** OPEN (extends DATA_FLOW "Gap" with field-level depth).
- **Owner:** Eng (data) + Compliance.
- **Residual risk after fix:** LOW-MEDIUM (ledger legitimate-interest retention is a policy decision).

## [MEDIUM] DP-5 — Subject-access export (Art.15) under-discloses (Candidate object only)
- **Area:** Data subject rights / portability (GDPR Art.15/20)
- **Affected:** `src/lib/store.ts:1404-1418` (`exportCandidate` → `JSON.stringify(cand)`).
- **Description:** The SAR export serializes **only** the `Candidate` object. It omits other personal data the controller holds about the same subject: `ClassifiedReply.body` (full reply text in `replies[]`), chat threads referencing them, agent `memory` entries, and the `outreach_ledger` rows. A data subject would receive an incomplete copy of their data.
- **Impact:** Incomplete Article 15 disclosure; portability gap.
- **Likelihood:** Medium (only on SAR exercise).
- **Reproduction:** Export a candidate who has replies/chat history; compare against the persisted state.
- **Evidence:** `store.ts:1404-1418`; `types.ts:883,895,896` (`replies`, `chats`, `memory` are separate top-level arrays).
- **Recommended fix:** Aggregate all personal data for the subject (candidate + their replies + chat/memory references + ledger rows) into the export; include a manifest of sources.
- **Tests to add:** Test that the export for a candidate with replies/chat includes those records.
- **Status:** OPEN (NEW).
- **Owner:** Eng (data).
- **Residual risk after fix:** LOW.

## [MEDIUM] DP-6 — Audit/activity trail stores candidate name in plaintext and survives anonymization
- **Area:** PII minimization in audit logs (GDPR Art.5(1)(c), ASVS V7/V9)
- **Affected:** `src/lib/store.ts:1957-1979` (`recordPiiReveal` writes `notes: "Contact details viewed for ${cand.name}. Purpose: outreach."` into `activities[]`, persisted in `workspace_state`); `anonymizeCandidate` does not scrub `activities[]`.
- **Description:** The PII-reveal audit entry — itself a good control — embeds the candidate's **name** verbatim in the activity feed. This activity is persisted in the workspace state blob and is **not** scrubbed by `anonymizeCandidate`, so the subject remains identifiable in the audit trail after "anonymization." Other compliance activities (`complianceMutate`) similarly may reference the candidate.
- **Impact:** Anonymization/erasure is defeated by the audit trail; PII persists indefinitely (also subject to DP-2 non-retention).
- **Likelihood:** Medium-High.
- **Reproduction:** Reveal a candidate, then anonymize; inspect `activities[]` — name still present.
- **Evidence:** `store.ts:1968`; `store.ts:1384-1402` (no activity scrub).
- **Recommended fix:** Log the candidate **id** (and optionally a salted hash), not the name, in audit notes; include `activities[]` in the erasure scrub for the subject.
- **Tests to add:** Test that audit notes contain no candidate name; test erasure scrubs activities.
- **Status:** OPEN (NEW).
- **Owner:** Eng (data).
- **Residual risk after fix:** LOW.

## [MEDIUM] DP-7 — No account or workspace deletion / data-removal workflow
- **Area:** Account lifecycle / erasure (GDPR Art.17, CIS §6)
- **Affected:** Auth routes present: `src/app/auth/signout/route.ts`, `src/app/api/auth/demo-login`. No delete-account / delete-workspace API or UI. Profiles delete only via `auth.users` ON DELETE CASCADE (`0001_init.sql:24`) with no app trigger.
- **Description:** Operators can sign out but cannot delete their account or the workspace's data. There is no API/UI to remove a profile, purge a workspace's `workspace_state`, or revoke connected mailboxes on offboarding. `workspace_state` and `outreach_ledger` have **no client DELETE policy** by design (`0005` §6/§9), so even an admin cannot wipe the workspace document from the app. Account/workspace teardown requires manual service-role DB action that is not documented.
- **Impact:** No self-service data removal; offboarding leaves PII + live OAuth tokens in place; no clean account-closure path.
- **Likelihood:** Medium (every offboarding / churn event).
- **Reproduction:** Search for any delete-account path → none; `0005` shows no DELETE policy on `workspace_state`.
- **Evidence:** `grep` of auth/api routes (only `signout`); `0005_rls_tenant_isolation.sql` §6, §9.
- **Recommended fix:** Add an admin-gated workspace data-deletion routine (service-role) that purges `workspace_state`, ledger PII, email connections (with token revocation at the provider), and cascades profile deletion; document the runbook.
- **Tests to add:** Integration test that workspace deletion removes all PII rows and revokes tokens.
- **Status:** OPEN (NEW). See `DATA_RETENTION_AND_DELETION.md`.
- **Owner:** Eng (data) + Ops.
- **Residual risk after fix:** LOW.

## [MEDIUM] DP-8 — Demo-mode localStorage persists full PII unencrypted and same-origin-readable
- **Area:** Encryption at rest / client storage (ASVS V9, A02)
- **Affected:** `src/lib/store.ts` localStorage path (key `hermes-sourcing:v1`); documented in `DATA_FLOW.md` "Demo Mode".
- **Description:** When Supabase is not configured, the **entire** `HermesState` (candidates, reply bodies, outreach content, chats, memory) is serialized to `localStorage` in cleartext on every change. It is readable by any same-origin JS (no `HttpOnly`), unencrypted, and persists until manually cleared. This is acceptable for synthetic demo data but is a real-PII hazard if demo mode is ever pointed at real candidates, and there is no hard guard preventing that.
- **Impact:** Plaintext PII at rest on the device; XSS or shared-device access exposes everything.
- **Likelihood:** Low in intended use; High if misused with real data.
- **Reproduction:** Run without Supabase env; inspect `localStorage["hermes-sourcing:v1"]`.
- **Evidence:** `DATA_FLOW.md` "Demo Mode — localStorage"; `store.ts` persistence.
- **Recommended fix:** Keep demo mode synthetic-only with a visible banner; refuse to persist if any record lacks a "synthetic" marker; never document localStorage mode for real candidates.
- **Tests to add:** Guard test that demo persistence rejects non-synthetic candidate records.
- **Status:** OPEN (documented in DATA_FLOW; reaffirmed here).
- **Owner:** Eng (frontend).
- **Residual risk after fix:** LOW.

## [MEDIUM] DP-9 — No secrets-manager / KMS strategy and no rotation; all secrets are plain env vars or plaintext DB
- **Area:** Secret management lifecycle (NIST SSDF PW.9, CIS §3.11/§3.12, ASVS V6)
- **Affected:** `.env.production.example` (lists `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_SECRET`, `RESEND_API_KEY`, `SENDGRID_API_KEY`, `HERMES_API_KEY` as plain env vars; no KMS/Vault guidance); migrations (no encryption); no rotation tooling.
- **Description:** Beyond DP-1 (DB columns), the platform-level secrets are managed as plain environment variables with no documented secrets manager, no rotation cadence, and no break-glass/rotation runbook. A leaked service-role key has no automatic invalidation path.
- **Impact:** Slow/uncertain response to secret exposure; broad standing privilege (service-role bypasses RLS).
- **Likelihood:** Medium.
- **Reproduction:** Review `.env.production.example` and migrations — no manager/rotation references.
- **Evidence:** `.env.production.example` key list; `grep` for vault/rotate → none.
- **Recommended fix:** Adopt a secrets manager (Vercel encrypted env is the floor; prefer Vault/KMS-backed) with documented rotation; minimize service-role usage; add a rotation runbook to `OPERATIONS_RUNBOOK.md`.
- **Tests to add:** N/A (process); add a CI check that no secret is committed (gitleaks already present, `ci.yml:42`).
- **Status:** OPEN (NEW emphasis).
- **Owner:** Tony + Ops.
- **Residual risk after fix:** LOW.

## [LOW] DP-10 — Confidentiality masking is render-only, off by default, and uses reversible hints
- **Area:** PII minimization (defense-in-depth, ASVS V9)
- **Affected:** `src/lib/confidential.ts` (`maskEmail`/`maskName`/`applyConfidentiality`); applied at render only; `settings.confidentialityMode` default off.
- **Description:** Masking is a presentation-layer control — the underlying PII is always in the store and persisted in full. The masks are partial/reversible hints (`maskEmail` keeps first char of local part + first char of domain + TLD; `maskName` keeps first name + last initial), so they reduce shoulder-surfing but provide no storage protection and are not anonymization. The control is well-tested (42/42 `rules-confidential.mts`) but is defense-in-depth only.
- **Impact:** Limited; mainly UX/insider shoulder-surfing reduction.
- **Likelihood:** Low.
- **Evidence:** `confidential.ts:11-58`; `rules-confidential.mts` 42 passed.
- **Recommended fix:** Document that masking is presentation-only; pair with the storage/erasure fixes above; consider defaulting `confidentialityMode` on for non-outreach views.
- **Status:** OPEN (informational).
- **Owner:** Eng (frontend).
- **Residual risk:** LOW.

## [LOW] DP-11 — `.env.local` present in working tree (gitignored, contains published Supabase demo keys only)
- **Area:** Secrets in repo (CIS §3, gitleaks)
- **Affected:** `.env.local` (untracked; `git ls-files` shows only `.env.local.example`).
- **Description:** The dirty working tree contains `.env.local` with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, anon + service-role keys whose decoded JWT payload is `{"iss":"supabase-demo","role":"anon"/"service_role"}` — i.e. the **universally published Supabase local-dev default keys**, not real secrets. It is correctly gitignored (`.gitignore`: `.env`, `.env*.local`). gitleaks runs in CI (`ci.yml:42-45`, non-blocking is not configured here — it is a normal step).
- **Impact:** None directly (public demo keys); risk is only if the file is ever replaced with real secrets and the ignore rule regresses.
- **Likelihood:** Low.
- **Reproduction:** Decode the JWT payloads of the `.env.local` keys → `iss: supabase-demo`.
- **Evidence:** base64-decoded JWT payloads; `.gitignore` lines; `git ls-files | grep env` → only `.env.local.example`.
- **Recommended fix:** Keep gitignore as-is; add a pre-commit gitleaks hook locally; never store real secrets in `.env.local` for shared machines.
- **Status:** ACCEPTED (informational; no real secret exposed).
- **Owner:** Tony.
- **Residual risk:** LOW.

---

## What is verifiably good (preserve)

- Read-path secret isolation: column-level grants + RLS withhold `secret`/tokens from `authenticated`; service-role is the only secret read path and is server-only (`config.ts:16`, `server.ts:43-46`).
- No secret/PII echoed in API responses; `security-audit.mts` enforces no hardcoded keys / no raw secret return; gitleaks in CI.
- LLM proxy does not log prompt content (no candidate PII in proxy logs); error logs carry only `{message, code}` / status.
- Render-time masking implemented and tested (42/42); PII reveal is audited (control intent correct — see DP-6 for the name-in-log fix).
- TLS in transit across all upstreams.

## Blocked / UNKNOWN (need access or decision)

- **Encryption at rest of the Supabase Postgres + backups, and KMS configuration** — UNKNOWN, blocked on Supabase project access. Needed: read access to the Supabase project security settings / confirmation of disk + backup encryption and whether Vault/pgsodium is provisioned.
- **Supabase Auth password/credential hashing** — N/A in repo (OAuth/SSR); standard Supabase handling assumed but not verifiable here.
- **Log destination, retention, and access controls** (Vercel/aggregator) — UNKNOWN; required to scope DP-3 residual risk.

---

## Cross-references
- `DATA_FLOW.md` — PII entry/exit/lifecycle (still accurate; this report adds field-level erasure/export depth).
- `DATA_RETENTION_AND_DELETION.md` — companion: retention windows, deletion/erasure matrix, account-removal runbook gaps.
- `SECURITY_REVIEW.md` G-4/G-5, `RISK_REGISTER.md` R5b/R9 — superseded/extended by DP-1, DP-3, DP-4 above.
