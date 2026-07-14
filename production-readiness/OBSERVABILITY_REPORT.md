# Observability Report — Hermes Sourcing (MSourcing)

> SUPERSEDED by `STATUS.md` 2026-07-10 for current release posture. Historical 2026-06-27 evidence may contain stale stack versions, suite counts, migration ranges, and verdicts.


**App:** Hermes Sourcing ("hermes-sourcing") — autonomous recruiting operations console
**Phase:** 11 — Observability / Operations
**Gate:** Gate 11 — Observability/operations
**Auditor role:** Observability / Ops Engineer
**Date:** 2026-06-27
**Repo state:** git branch `main`, **working tree DIRTY** (audited as-is; many `src/app/**` and `next.config.mjs`, `ci.yml`, `package.json` files show uncommitted modifications — see `git status`). Findings reference the current on-disk tree.
**Self-description (package.json):** "MVP demo, mock integrations, synthetic data."

---

## Executive summary

Hermes Sourcing has **no production observability stack**. There is no error-tracking (no Sentry/Rollbar/Bugsnag), no metrics (no Prometheus/StatsD/Vercel Analytics/Speed Insights), no distributed tracing (no OpenTelemetry, no `instrumentation.ts`), no log aggregation/drain, and no defined log retention. What exists is:

1. A shallow **liveness probe** at `GET /api/health` returning booleans + Node version (no secrets) — good as far as it goes, but it does not actually test the database, the Hermes/AI upstream, or the email providers, and nothing in the repo polls it.
2. Three ad-hoc **structured-JSON `console` loggers** (`hermes-proxy`, `email-provider`) that write to stdout/stderr — captured only as ephemeral Vercel function logs, **with no request/trace/tenant correlation IDs**, no log levels beyond info/error, and **no alerting on top of them**.
3. A client-side **"activities" ring buffer** (max 300 global / 80 per campaign) persisted inside the `workspace_state` JSONB blob. This is a **UI activity feed, not a security audit log** — it is client-written, client-mutable, capped/lossy, and carries no tamper-evidence.

Critically for a system that handles candidate PII, recruiter messages, OAuth mailbox tokens and API keys:
- **Logs contain candidate PII** (recipient email addresses) in plaintext (`src/lib/providers.ts`), shipped to Vercel's log store with **UNKNOWN retention** and no scrubbing.
- **Sensitive/admin actions are not durably audited** — API-key creation/deletion only `console.error` on *failure*; key deletion, role changes, and seat live-mode toggles leave no audit trail.
- **No alerting exists** for any of: outage, error rate, latency, saturation, failed jobs, DB health, backup failure, cert expiry, auth anomaly, or cost. The thresholds listed in the incident runbook are *aspirational design*, not implemented controls.
- **No on-call / ownership** is configured (runbook contacts are `<name>` placeholders).
- **No synthetic/uptime monitoring** is configured.

This is consistent with the stated MVP/demo posture, but it means the app is **operationally blind**. Any pre-production deployment that handles real candidate data must implement the items in `ALERTING_REPORT.md` first.

### Gate 11 decision: **FAIL**

Multiple HIGH findings are OPEN (no error-tracking, no metrics/traces, no alerting, no durable audit log for sensitive/admin actions, PII in logs). Several required checks are UNKNOWN — blocked on access (log retention, whether any external monitor is wired to the deployed instance). Per the conservative rule (unknown/untested = FAIL or UNKNOWN, never PASS), the gate cannot pass.

---

## Scope & method

Read-only audit of the current working tree. Evidence gathered by `grep`/`cat`/file reads over `src/`, `supabase/`, `next.config.mjs`, `vercel.json`, `.github/workflows/`, `package.json`, and the existing `production-readiness/` docs. No live cloud/staging/prod access was authorized; anything requiring the deployed Vercel/Supabase project is marked **UNKNOWN — blocked on access**.

Baselines applied: OWASP ASVS L2/L3 (V7 Error Handling & Logging), OWASP Top 10 (A09 Security Logging & Monitoring Failures), OWASP API Security Top 10 (API9 Improper Inventory / insufficient logging), NIST CSF (DE.AE, DE.CM, PR.PT-1 audit logging), CIS Controls v8 (8 — Audit Log Management), NIST SSDF (PO/PW logging practices).

---

## Current-state inventory (what exists, with evidence)

| Capability | State | Evidence |
|---|---|---|
| Liveness probe | Partial | `src/app/api/health/route.ts` — `GET /api/health` returns `{ ok, status, time, checks:{app, supabaseConfigured, hermesConfigured, emailDomainRestricted, node} }`, `Cache-Control: no-store`. Booleans only, no secrets. Does **not** ping DB/upstream. |
| Readiness/deep health | Absent | No route validates DB connectivity, Hermes reachability, or provider auth. `supabaseConfigured` only checks that env vars are *set*. |
| Structured logging | Partial / ad-hoc | `logUpstream()` `src/app/api/hermes/chat/route.ts:69-80` (source `hermes-proxy`); `auditLog()` `src/lib/providers.ts:3-12` (source `email-provider`); `logUpstream()` `src/lib/api/hermes-proxy.ts:13-20`. JSON to `console.log`/`console.error`. |
| Total `console.*` sites | 16 across 9 files | `src/app/api/{hermes/chat,keys,outreach/send}/route.ts`, `src/lib/{api/hermes-proxy,email-oauth,providers,seed,supabase/workspace}.ts`, `src/app/not-found.tsx`. |
| Correlation / trace IDs | Absent | No request-id, no workspace-id/user-id tagging, no trace context in any log line. |
| Error tracking | Absent | No `sentry`, `rollbar`, `bugsnag`, `datadog`, `newrelic`, `@opentelemetry`, `pino`, `winston` in `package.json`. No `sentry*.config.*`, no `instrumentation.ts`. |
| Metrics | Absent | No `@vercel/analytics`, `@vercel/speed-insights`, prometheus/statsd. No `/metrics` endpoint. No RED/USE counters. |
| Tracing | Absent | No OpenTelemetry SDK / instrumentation. |
| Log aggregation / drain | Absent / UNKNOWN | No log-drain config in `vercel.json`. Whether a drain exists on the deployed project is **UNKNOWN — blocked on access**. |
| Log retention policy | UNKNOWN → FAIL | No retention defined in repo. Vercel function-log retention is plan-dependent and short by default; Supabase log retention plan-dependent. Not documented, not configured. |
| Activity feed ("ring buffer") | Present (not audit) | `src/lib/store.ts:445-453` `withActivity` keeps `slice(0,300)` global / `slice(0,80)` per campaign; `logActivity` `:253,475-477`; persisted via `saveRemoteState` `src/lib/supabase/workspace.ts:64-77` inside `workspace_state` JSONB. Client-written, client-mutable, lossy. |
| Server-side audit log (sensitive/admin) | Absent | No `audit_log`/`audit_trail` table in `supabase/migrations/*`. `outreach_ledger` (`0002_fleet.sql:42-53`) is a partial send-audit (seat_id, at, status). API-key writes log only on failure (`src/app/api/keys/route.ts:54,75`). |
| Dashboards | Absent | None in repo; none referenced beyond aspirational runbook text. |
| Alerting | Absent | See `ALERTING_REPORT.md`. No Slack/PagerDuty/webhook/cron. |
| Synthetic / uptime checks | Absent / UNKNOWN | Described in `OPERATIONS_RUNBOOK §5` but not implemented; no external monitor config in repo. Deployed state **UNKNOWN — blocked on access**. |
| On-call / ownership | Absent | `INCIDENT_RESPONSE_RUNBOOK` "On-call contacts" are `<name>` placeholders. |
| Supabase `[analytics]` | Local-only | `supabase/config.toml:388` `[analytics] enabled = true backend = "postgres"` is the **local dev** Logflare stack, not the deployed project's observability. |
| CI observability checks | Absent | `.github/workflows/ci.yml` runs typecheck/lint/test/build + `npm audit` (non-blocking) + gitleaks. No health/smoke/observability gate. |

---

## Findings

## [HIGH] No production error-tracking (operationally blind to runtime exceptions)
- **Area:** Observability — error tracking
- **Affected:** whole app; `package.json` (no error-tracking dep); no `instrumentation.ts`; no `sentry*.config.*`
- **Description:** There is no exception-aggregation/error-tracking service. Unhandled errors and caught errors are only written to `console.error` and land in Vercel function logs, which are ephemeral, unindexed for alerting, and not grouped/deduplicated. No source-map upload, no release/version tagging, no breadcrumb/user context.
- **Impact:** Production errors (auth failures, RLS denials, upstream 5xx, provider send failures, OAuth refresh failures) are invisible unless someone is tailing logs at the right moment. MTTD/MTTR for incidents is effectively unbounded. Directly maps to OWASP A09 (Security Logging & Monitoring Failures).
- **Likelihood:** High — guaranteed to bite the first time a real error occurs in prod.
- **Reproduction:** `grep -rniE "sentry|rollbar|bugsnag|datadog|opentelemetry|newrelic" package.json src/` → no matches; `find . -name instrumentation.ts -o -name "sentry*.config.*"` → none.
- **Evidence:** `package.json` dependency list (no error-tracking pkg); absence of `instrumentation.ts`.
- **Recommended fix:** Add Sentry (`@sentry/nextjs`) or equivalent with `instrumentation.ts`/`sentry.{client,server,edge}.config.ts`, DSN via env, source-map upload in CI, release tagging from the Vercel commit SHA, and PII scrubbing (`beforeSend` strips candidate emails/message bodies). Wire critical-error alerts to the on-call channel (see `ALERTING_REPORT.md`).
- **Tests to add:** A test asserting the error-tracking init module is imported and that `beforeSend` redacts email-shaped strings; a CI smoke step that triggers a sample captured error in a preview deploy.
- **Status:** OPEN
- **Owner:** Eng
- **Residual risk:** Until added, all runtime errors are detectable only by manual log inspection.

## [HIGH] No metrics or tracing (no RED/USE signals, no latency/saturation visibility)
- **Area:** Observability — metrics & traces
- **Affected:** whole app; `package.json` (no metrics/tracing deps); no `/metrics` endpoint
- **Description:** No request-rate/error-rate/duration (RED) metrics, no utilization/saturation (USE) metrics, no distributed tracing. There is no Vercel Analytics/Speed Insights dependency and no Prometheus/StatsD/OTel exporter. The only latency-bounding mechanism is the 30s `AbortSignal.timeout` on the Hermes/cloud upstream (`src/app/api/hermes/chat/route.ts` `UPSTREAM_TIMEOUT_MS`), which is a timeout, not a metric.
- **Impact:** Cannot detect latency regressions, error-rate spikes, throughput anomalies, or saturation (e.g., serverless concurrency, DB connection pressure). SLOs in `OPERATIONS_RUNBOOK §5` (P99 < 10s for `/api/hermes/chat`, <0.5% 4xx, <0.1% 5xx) are unmeasurable as written.
- **Likelihood:** High.
- **Reproduction:** `grep -niE "analytics|speed-insights|prometheus|statsd|opentelemetry" package.json` → no relevant matches.
- **Evidence:** `package.json`; no metrics route under `src/app/api/`.
- **Recommended fix:** Add Vercel Analytics + Speed Insights for baseline web/RUM signals; emit server RED metrics for each `/api/*` route (count, status class, duration) to a backend (Vercel Observability, Datadog, or an OTel collector). Define and instrument the SLOs already written in the ops runbook. Add OTel tracing across the `chat → Hermes/cloud upstream` and `outreach/send → provider` call chains so the cross-service latency is attributable.
- **Tests to add:** Unit test that the metrics wrapper records status + duration for a mocked handler.
- **Status:** OPEN
- **Owner:** Eng
- **Residual risk:** No data to drive capacity, SLOs, or regression detection.

## [HIGH] Candidate PII (recipient email) and provider response bodies written to logs
- **Area:** Observability — log hygiene / data minimization (GDPR)
- **Affected:** `src/lib/providers.ts:77,82,99,102,108,126,129,137`; `src/lib/email-oauth.ts:68`
- **Description:** The email-provider audit logger writes the candidate recipient address (`to: req.to`) on every send attempt/success/failure, and the `from` (operator) address on the attempt line (`providers.ts:77`). On SendGrid failure it logs `body: txt.slice(0,500)` (`providers.ts:126`) and the Microsoft Graph adapter logs the upstream error body `txt.slice(0,500)` (`email-oauth.ts:68`) — provider error bodies can echo recipient/account data. These lines flow to `console.*` → Vercel function logs, a third-party log store, with **no scrubbing** and **UNKNOWN retention**.
- **Impact:** Candidate email addresses (personal data under GDPR) are persisted in operational logs outside the RLS-protected database, expanding the data-protection blast radius and the set of systems subject to data-subject erasure. Violates ASVS V7 (no sensitive data in logs) and data-minimization. The prompt's required check "logs free of secrets/PII" fails here.
- **Likelihood:** High — emitted on every live send and on every provider error.
- **Reproduction:** Read `src/lib/providers.ts` `sendViaProvider`; observe `to: req.to` and `body: txt.slice(0,500)` in log calls.
- **Evidence:** `src/lib/providers.ts:77` `auditLog("info","Send attempt",{provider,from,to:req.to})`; `:126` SendGrid failure logs response body; `src/lib/email-oauth.ts:68` Graph error body slice.
- **Recommended fix:** Replace raw `to`/`from` with a salted hash or last-domain-only token, or a candidate UUID, in logs. Never log provider response bodies that may contain PII — log status code + a stable error code only. Add a central log-scrubber so PII can never reach the sink. (Note: secrets are already handled well — bearer tokens/API keys are explicitly never logged; this finding is about PII, not secrets.)
- **Tests to add:** A log-redaction unit test asserting no `@`-containing email string and no provider body appears in emitted log entries for a simulated send/failure.
- **Status:** OPEN
- **Owner:** Eng + DPO
- **Residual risk:** Until fixed, candidate emails accumulate in Vercel logs subject to GDPR.

## [HIGH] No durable, tamper-evident audit log for sensitive/admin actions; the "activities ring buffer" is not an audit log
- **Area:** Observability — security audit logging
- **Affected:** `src/lib/store.ts:253,445-453,475-477`; `src/lib/supabase/workspace.ts:64-77`; `src/app/api/keys/route.ts:48-58,71-78`; `supabase/migrations/*` (no audit table)
- **Description:** The in-app "activities" feed is a **client-side UI log**: written by the browser via `logActivity`, capped at 300 global / 80 per campaign (`slice(0,300)` / `slice(0,80)`), and persisted as part of the `workspace_state` JSONB document that the client upserts wholesale (`saveRemoteState`). It is therefore client-mutable, lossy, non-append-only, and carries no actor identity binding, no integrity protection, and no admin separation. It is not a security audit trail.
  Meanwhile, sensitive/admin actions have **no server-side audit record**:
  - API-key **creation** writes the row (with `created_by`, `created_at`) but emits an audit line only on *failure* (`keys/route.ts:54`); API-key **deletion** removes the row and logs only on failure (`:75`) — there is no who/when/what record of a deletion.
  - **Role changes**, **seat live-mode toggles**, **`confirmLive` send approvals**, **OAuth seat (re)connections**, and **service-role operations** have no audit rows.
  - `outreach_ledger` (`0002_fleet.sql:42-53`) is a *partial* send-audit (seat_id, at, status, reason) — good, but it records the seat, not the human approver, and covers only outreach.
- **Impact:** After an incident (rogue admin, key abuse, unauthorized config change, suppression bypass) there is no reliable record of who did what when. Fails CIS Control 8, NIST CSF PR.PT-1, ASVS V7.2 (audit of security-relevant events), and OWASP A09. The prompt explicitly requires assessing "audit logs for sensitive/admin actions" — they are effectively absent.
- **Likelihood:** Medium-High — matters the moment any abuse/dispute investigation is needed.
- **Reproduction:** `grep -rniE "audit_log|audit_trail" supabase/migrations` → none; read `keys/route.ts` (no success-path audit); read `store.ts` ring-buffer slices.
- **Evidence:** As cited above.
- **Recommended fix:** Add an append-only server-side `audit_log` table (workspace_id, actor_user_id, actor_email, action, target_type, target_id, metadata jsonb, at) written by the **service-role** client (not the browser) for every sensitive/admin action: key create/delete/test, role change, seat mode change, send approval (`confirmLive`), OAuth connect/disconnect, suppression edits. Enforce insert-only RLS (no update/delete for app roles). Surface it in an admin-only view. Keep the client "activities" feed as the UX timeline, clearly separate from the audit log.
- **Tests to add:** Integration tests asserting each sensitive action writes exactly one audit row with the correct actor; a test asserting the audit table rejects UPDATE/DELETE under the authenticated role.
- **Status:** OPEN
- **Owner:** Eng + Security
- **Residual risk:** No forensics or accountability for admin/sensitive actions.

## [HIGH] No alerting on any operational/security signal
- **Area:** Observability — alerting (full detail in `ALERTING_REPORT.md`)
- **Affected:** whole platform; `vercel.json` (no cron/monitor); `.github/workflows/ci.yml`; runbooks
- **Description:** No alert is implemented for outage, 5xx/4xx error rate, latency, saturation, failed jobs, DB errors, backup failure, TLS-cert expiry, auth anomaly, or cost. The thresholds in `INCIDENT_RESPONSE_RUNBOOK §1` are labelled "configure before going live" — they are design intent, not running controls. No Slack/PagerDuty/webhook integration, no Vercel/Supabase alert rules in repo.
- **Impact:** Incidents are detected only by chance or user report. Combined with the no-error-tracking and no-metrics findings, the platform is operationally blind. OWASP A09.
- **Likelihood:** High.
- **Reproduction:** `grep -ni cron vercel.json` → none; no alerting integration anywhere in `src/` or config.
- **Evidence:** `vercel.json` (headers + build only); `ci.yml`; `INCIDENT_RESPONSE_RUNBOOK §1`.
- **Recommended fix:** Implement the alert catalogue in `ALERTING_REPORT.md` before any real-data deployment.
- **Status:** OPEN
- **Owner:** Ops
- **Residual risk:** Blind to all production incidents.

## [MEDIUM] `/api/health` is a shallow liveness probe, not a readiness check; nothing polls it
- **Area:** Observability — health checks / synthetic monitoring
- **Affected:** `src/app/api/health/route.ts`
- **Description:** The probe returns static booleans and `process.version`. `supabaseConfigured`/`hermesConfigured` only assert env vars are *set* — they do not test DB connectivity, run a trivial query, check the Hermes/AI upstream, or verify provider auth. No synthetic/uptime monitor in the repo is wired to it (the `OPERATIONS_RUNBOOK §5` uptime table is aspirational). A dependency outage (DB down, upstream down) returns `200 healthy`.
- **Impact:** False-green health: a degraded backend reports healthy, defeating load-balancer/uptime-monitor decisions and masking partial outages.
- **Likelihood:** Medium.
- **Reproduction:** Read the route; note no `await supabase...` ping. Stop the DB → endpoint still returns 200.
- **Evidence:** `src/app/api/health/route.ts` (entire handler).
- **Recommended fix:** Add a `GET /api/health?deep=1` (or `/api/ready`) that does a cheap `select 1`/`current_workspace_id()` against Supabase and an optional HEAD to the Hermes upstream, returning per-dependency status and a non-200 when a critical dependency is down. Then configure an external synthetic monitor (Checkly/Better Uptime/Vercel) against `/login` (expect 200), `/api/keys` unauth (expect 401 — auth-gate canary, already in runbook), and the deep health route.
- **Tests to add:** Test that deep health returns non-200 when the DB client is unavailable.
- **Status:** OPEN
- **Owner:** Eng + Ops
- **Residual risk:** Outages can present as healthy.

## [MEDIUM] Logs lack correlation IDs, tenant/user context, and consistent levels
- **Area:** Observability — log quality
- **Affected:** `src/app/api/hermes/chat/route.ts:69-80`; `src/lib/providers.ts:3-12`; `src/lib/api/hermes-proxy.ts:13-20`; all 16 `console.*` sites
- **Description:** Three independent JSON loggers with `source`/`level`/`message` but **no request-id/trace-id, no workspace_id, no user_id**, and only `info`/`error` levels. `console.warn` is used elsewhere (`supabase/workspace.ts`) outside the structured format, and `not-found.tsx` uses `console` for a non-log purpose. Cross-request correlation and per-tenant log filtering are impossible.
- **Impact:** During an incident you cannot follow one request across the proxy→upstream→provider path, nor scope logs to the affected workspace/user. Slows triage.
- **Likelihood:** Medium.
- **Evidence:** Logger definitions cited; `grep -rln "console\." src/` (9 files, mixed styles).
- **Recommended fix:** Centralize a single structured logger; inject a per-request `requestId` (from a header or generated) and attach `workspace_id`/`user_id` where available (never the email/secret); standardize levels (debug/info/warn/error); route all sites through it.
- **Tests to add:** Test that the logger always includes `requestId` and never includes secret-shaped or email-shaped values.
- **Status:** OPEN
- **Owner:** Eng
- **Residual risk:** Slower triage; noisier logs.

## [MEDIUM] Log retention undefined; no log drain
- **Area:** Observability — retention
- **Affected:** deployment config; `vercel.json`; `supabase/config.toml`
- **Description:** No log-retention policy is defined or configured. Vercel function logs are short-lived by default (plan-dependent) and there is no log drain in `vercel.json`; Supabase log retention is plan-dependent. The `[analytics]` block in `supabase/config.toml:388` is the **local** Logflare stack only. For a system under GDPR you need *both* a defined retention (long enough for incident forensics, short enough for data minimization) *and* a place logs are durably kept.
- **Impact:** Incident logs may already be expired by the time an investigation starts (UNKNOWN how long Vercel keeps them on the chosen plan); conversely PII-bearing logs may be retained indefinitely in a drain without a deletion policy. Either way, undocumented = ungoverned.
- **Likelihood:** Medium.
- **Evidence:** No drain in `vercel.json`; no retention doc; `config.toml:388` is local-only.
- **Recommended fix:** Decide a retention window (e.g., 30–90 days) aligned with the DPIA; configure a Vercel log drain (Pro/Enterprise) or Supabase log export to a store with that retention and an automatic deletion job; document it in the ops runbook and privacy policy. Confirm the deployed plan's default retention.
- **Status:** UNKNOWN → treat as OPEN (blocked on access to confirm the deployed plan/drain)
- **Owner:** Ops + DPO
- **Residual risk:** Forensic gaps and/or over-retention of PII.

## [MEDIUM] On-call / ownership not defined
- **Area:** Operations — ownership
- **Affected:** `production-readiness/INCIDENT_RESPONSE_RUNBOOK.md` "On-call contacts"
- **Description:** All on-call/escalation/DPO contacts are `<name>` placeholders. No rotation, no paging integration, no defined primary/backup.
- **Impact:** Even if an alert fired, there is no defined human to receive it within SLA.
- **Likelihood:** Medium.
- **Evidence:** Runbook "On-call contacts" table.
- **Recommended fix:** Populate real primary/backup on-call + DPO; wire a pager (PagerDuty/Opsgenie or a Slack on-call channel) before go-live.
- **Status:** OPEN
- **Owner:** Eng manager
- **Residual risk:** Alerts (once they exist) have no guaranteed responder.

## [LOW] CI has no observability/smoke gate; `npm audit` non-blocking
- **Area:** CI / operations
- **Affected:** `.github/workflows/ci.yml`
- **Description:** CI runs typecheck/lint/test/build + gitleaks, but `npm audit --audit-level=high || true` is non-blocking and there is no post-deploy smoke check (e.g., curl `/api/health`) and no test exercising the health/observability surface (`tests/` has 22 suites, none cover health/logging/metrics).
- **Impact:** Regressions in the health endpoint or logging hygiene, and known high CVEs, can ship unnoticed.
- **Likelihood:** Low-Medium.
- **Evidence:** `.github/workflows/ci.yml`; `ls tests/*.mts` (22 suites; none for health/observability).
- **Recommended fix:** Add a preview-deploy smoke step (assert `/api/health` 200 and `/api/keys` unauth 401); add a log-redaction unit test; make `npm audit` blocking on critical or track exceptions explicitly.
- **Status:** OPEN
- **Owner:** Eng
- **Residual risk:** Minor; defense-in-depth gap.

---

## What is genuinely good (preserve)

- **Secrets are not logged.** Bearer tokens / API keys are explicitly resolved server-side and never logged or returned (`hermes/chat/route.ts` `resolveVaultSecret`, comments at logger sites). The `api_keys.secret` column is withheld from the `authenticated` role at the column-grant level (`0003_api_keys.sql`).
- **`/api/health` exposes no secrets** and sets `Cache-Control: no-store` — safe to poll publicly.
- **`outreach_ledger`** gives a partial, server-side, RLS-scoped audit of outreach sends (who-seat/when/status/reason) and is the de-dupe source of truth.
- **Structured-JSON logging** is already the pattern in the two server loggers (just needs correlation IDs + PII scrubbing, not a rewrite).
- **Security headers** (CSP, HSTS in `vercel.json`, X-Frame-Options DENY, nosniff, referrer/permissions policy) are present in `next.config.mjs` + `vercel.json`.

---

## Required checks for Gate 11 — verdict table

| Required check | Verdict | Evidence |
|---|---|---|
| Structured logs present | PARTIAL | 3 JSON loggers; ad-hoc, no correlation IDs |
| Metrics present | FAIL | none |
| Traces present | FAIL | none |
| Error-tracking present | FAIL | none |
| Logs free of secrets | PASS | secrets never logged |
| Logs free of PII | **FAIL** | candidate emails + provider bodies logged (`providers.ts`, `email-oauth.ts`) |
| Dashboards | FAIL | none |
| Alerts (outage/errors/latency/saturation/failed-jobs/queue/DB/backup/cert/auth/cost) | FAIL | none (see ALERTING_REPORT) |
| On-call / ownership | FAIL | placeholders only |
| Audit logs for sensitive/admin actions | **FAIL** | client ring buffer is not an audit log; no server audit table |
| Runbooks (operations + incident) | PASS (updated) | `OPERATIONS_RUNBOOK.md`, `INCIDENT_RESPONSE_RUNBOOK.md` updated this phase |
| Synthetic / uptime checks | FAIL / UNKNOWN | none in repo; deployed state blocked on access |
| Log retention | UNKNOWN → FAIL | undefined; no drain |

**Gate 11: FAIL.**

---

## Blockers (need access/decision to clear)

1. **Access to the deployed Vercel + Supabase projects** to confirm whether any external monitor, log drain, alert rule, or Analytics integration exists outside the repo, and the actual log-retention window.
2. **Decision on the observability stack** (Sentry vs Datadog vs Vercel-native vs OTel collector) and budget.
3. **Real on-call rotation + paging integration** and DPO contact.
4. **DPIA-aligned log-retention decision** (window + PII-scrubbing policy).

## Related deliverables
- `ALERTING_REPORT.md` — alert catalogue, thresholds, routing (this phase).
- `OPERATIONS_RUNBOOK.md` — updated with observability status banner + monitoring setup (this phase).
- `INCIDENT_RESPONSE_RUNBOOK.md` — updated with "alerts NOT implemented" warning + audit-log forensics caveat (this phase).
- Cross-references: `DATA_PROTECTION_REPORT.md` (PII), `BACKUP_RESTORE_REPORT.md` (backup-failure alerting), `CICD_REVIEW.md` (CI gates), `RISK_REGISTER.md`, `RELEASE_GATE_MATRIX.md` (Gate 11 row already FAIL — confirmed).
