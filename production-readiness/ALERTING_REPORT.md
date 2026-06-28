# Alerting Report — Hermes Sourcing (MSourcing)

**App:** Hermes Sourcing ("hermes-sourcing")
**Phase:** 11 — Observability / Operations
**Gate:** Gate 11 — Observability/operations
**Date:** 2026-06-27
**Repo state:** branch `main`, working tree DIRTY (audited as-is).

---

## Executive summary

**No alerting is implemented anywhere in the repository or (verifiably) in the deployment.** The thresholds in `INCIDENT_RESPONSE_RUNBOOK.md §1 "Detect"` are an *aspirational design table* explicitly captioned "configure before going live" — they are not running controls. There is:

- no Slack/PagerDuty/Opsgenie/webhook integration,
- no Vercel/Supabase alert rule defined in repo,
- no scheduled job (`vercel.json` has no `crons`),
- no synthetic/uptime monitor wired to `/api/health`,
- no error-tracking backend to alert on (see `OBSERVABILITY_REPORT.md`),
- no cost/budget alerts.

Because alerting depends on signals that do not exist yet (no metrics, no error-tracking, no durable audit log), alerting cannot be partially credited. This report therefore (1) records the current FAIL state with evidence and (2) specifies the **alert catalogue to build** before any deployment that handles real candidate data.

### Gate contribution: **FAIL** — no alert is implemented for any required signal.

---

## Current state (evidence)

| Item | State | Evidence |
|---|---|---|
| Alert integration (Slack/PagerDuty/webhook) | Absent | no such code/config in `src/` or root config |
| Scheduled checks / crons | Absent | `grep -ni cron vercel.json` → no match |
| Synthetic/uptime monitor | Absent | none in repo; `OPERATIONS_RUNBOOK §5` table is aspirational |
| Error-rate / latency / saturation alerts | Absent | no metrics backend (`package.json` has no analytics/otel) |
| Backup-failure alert | Absent | `BACKUP_RESTORE_REPORT.md` / `OPERATIONS_RUNBOOK §1` describe manual weekly checks only |
| Cert-expiry alert | Absent | manual monthly `openssl` check in `OPERATIONS_RUNBOOK §4` |
| Auth-anomaly alert | Absent | `middleware.ts` performs redirects but logs/alerts nothing on denied access |
| Cost alert | Absent | none for Vercel / Supabase / LLM providers / email providers |
| Failed-job / queue alert | N/A → Absent | no async job/queue system in repo; outreach is synchronous per request |
| Incident-runbook detect table | Design only | `INCIDENT_RESPONSE_RUNBOOK.md §1` ("configure before going live") |

> The Incident Response Runbook §1 table is good *target* design. This report turns it into an implementable catalogue and records that **none of it is live**.

---

## Findings

## [HIGH] No alerting implemented for any operational or security signal
- **Area:** Alerting
- **Affected:** whole platform; `vercel.json`, `.github/workflows/ci.yml`, runbooks
- **Description:** None of outage, error-rate, latency, saturation, DB health, backup failure, cert expiry, auth anomaly, failed jobs, or cost has an implemented alert. No notification channel is integrated.
- **Impact:** Detection of any incident — including a tenant-isolation breach, an unauthorized live send, an auth-gate regression, or a total outage — relies on luck or user reports. Maps to OWASP A09 (Security Logging & Monitoring Failures), NIST CSF DE.AE/DE.CM, CIS Control 8.
- **Likelihood:** High.
- **Reproduction:** `grep -rniE "slack|pagerduty|opsgenie|webhook|alert|cron" vercel.json src/` → no alerting wiring.
- **Evidence:** absence across repo; runbook §1 caption "configure before going live".
- **Recommended fix:** Implement the alert catalogue below.
- **Status:** OPEN
- **Owner:** Ops
- **Residual risk:** Operationally blind until built.

## [HIGH] Security-relevant alerts cannot fire (no source signals)
- **Area:** Alerting — security
- **Affected:** auth gate (`middleware.ts`), key vault (`api/keys`), outreach (`api/outreach/send`), proxy (`api/hermes/chat`)
- **Description:** The most important security alerts for this app — auth-failure spikes, `/api/keys` returning non-401 to unauth callers (auth-gate canary), unexpected live sends, SSRF-blocked URL attempts, `claim_and_record` errors (suppression broken) — have no metric/event source and no alert. The proxy *does* log SSRF blocks (`hermes/chat/route.ts` `logUpstream("error","Blocked Aria URL due to SSRF policy")`) and `claim_and_record` errors are logged (`outreach/send/route.ts`), but nothing watches those log lines.
- **Impact:** A live security regression (e.g., auth gate broken after a deploy, suppression bypass) would not page anyone.
- **Likelihood:** Medium-High.
- **Evidence:** logger sites exist but no consumer/alert; `INCIDENT_RESPONSE_RUNBOOK §1` lists these as desired alerts only.
- **Recommended fix:** Once error-tracking + metrics exist, add the SECURITY alerts in the catalogue (auth-gate canary, SSRF-block rate, suppression-RPC error, unexpected live send).
- **Status:** OPEN
- **Owner:** Security + Ops
- **Residual risk:** Security incidents detected late.

## [MEDIUM] No cost/budget alerting
- **Area:** Alerting — cost (FinOps)
- **Affected:** Vercel, Supabase, LLM provider keys, email providers
- **Description:** No spend alerts. A runaway loop calling `/api/hermes/chat` (LLM cost) or a send storm (email cost) or DB egress would not trigger any budget alert.
- **Impact:** Surprise cost / potential abuse amplification with no early warning.
- **Likelihood:** Medium.
- **Evidence:** no budget config in repo; no provider cost-cap wiring.
- **Recommended fix:** Enable Vercel spend management, Supabase usage alerts, per-provider hard usage caps (Anthropic/OpenAI/etc.), and an email-volume alert keyed off `outreach_ledger` daily counts.
- **Status:** OPEN
- **Owner:** Ops + Finance
- **Residual risk:** Cost overrun / abuse cost.

---

## Alert catalogue to implement (target design)

Severity maps to `INCIDENT_RESPONSE_RUNBOOK.md` (P1–P4). Route P1/P2 to a pager + on-call channel; P3/P4 to the ops channel. **None of these are implemented today — this is the build list.**

### Availability / outage
| Alert | Signal source | Threshold | Sev | Route |
|---|---|---|---|---|
| App down | Synthetic GET `/login` | non-200 > 2 min | P1 | pager |
| Health failing | Synthetic GET `/api/health` (deep) | non-200 or critical dep down > 2 min | P1 | pager |
| Auth-gate canary | Synthetic GET `/api/keys` unauth | response ≠ 401 for > 1 min | P1 | pager (auth bypass) |

### Errors / latency / saturation
| Alert | Signal source | Threshold | Sev | Route |
|---|---|---|---|---|
| 5xx rate on `/api/*` | metrics/error-tracking | > 1% over 5 min | P2 | pager |
| 4xx rate (excl. expected 401) | metrics | sustained spike | P3 | ops |
| `/api/hermes/chat` p99 latency | metrics/traces | > 10 s p99 | P3 | ops |
| Upstream timeout rate (30s abort) | logs/metrics | sustained bursts | P3 | ops |
| Serverless concurrency / function errors | Vercel | platform-defined | P2 | ops |
| Unhandled exception (new issue) | error-tracking | any new high-volume issue | P2 | ops |

### Data layer
| Alert | Signal source | Threshold | Sev | Route |
|---|---|---|---|---|
| Supabase connection/API errors | Supabase metrics | sustained burst | P2 | pager |
| `claim_and_record()` RPC errors | app logs/metrics | any | P2 | pager (suppression may be broken) |
| RLS policy violation | Supabase Postgres logs | any | P1 | pager (tenant isolation) |
| DB saturation (CPU/connections/disk) | Supabase metrics | plan thresholds | P2 | ops |
| Backup failure / stale backup | Supabase backups | latest backup > 25 h | P2 | ops |

### Email / outreach
| Alert | Signal source | Threshold | Sev | Route |
|---|---|---|---|---|
| Bounce rate per seat | provider webhooks | > 5% | P2 → auto-pause seat | ops |
| Complaint rate per seat | provider webhooks | > 0.1% | P1 → auto-pause seat | pager |
| Unexpected live send | `outreach_ledger` watch | any send without prior approval record | P1 | pager |
| Send-volume spike (cost/abuse) | `outreach_ledger` daily count | seat over configured cap | P2 | ops |
| OAuth token refresh failures | app logs | consecutive failures for a seat | P3 | ops |

### Security / auth
| Alert | Signal source | Threshold | Sev | Route |
|---|---|---|---|---|
| Auth failure spike | Supabase auth logs | > 10 failures/min | P2 | ops |
| SSRF-block rate (proxy) | `logUpstream` "Blocked Aria URL" | sustained | P2 | ops |
| Admin/sensitive action (once audit log exists) | `audit_log` table | any key delete / role change / seat→live | P3 notify | ops |
| Service-role key usage anomaly | infra | unexpected source | P1 | pager |

### Infra / cert / cost
| Alert | Signal source | Threshold | Sev | Route |
|---|---|---|---|---|
| TLS cert expiry | external cert monitor | < 14 days | P3 | ops |
| Sending-domain SPF/DKIM/DMARC drift | DNS monitor | record missing/changed | P3 | ops |
| Vercel spend | Vercel spend mgmt | over budget % | P3 | ops + finance |
| Supabase usage | Supabase alerts | over plan % | P3 | ops + finance |
| LLM provider spend | provider dashboards/caps | over budget | P3 | ops + finance |

### Implementation notes
- **Synthetic checks** (availability + auth-gate canary) are the cheapest highest-value first step — Checkly / Better Uptime / Vercel monitors against `/login`, `/api/health`, and `/api/keys` (unauth → expect 401). This can ship before the full metrics stack.
- **Bounce/complaint** alerts require provider webhooks (Resend/SendGrid) which are not configured (`src/lib/providers.ts` posts sends but registers no webhook handler) — add an inbound webhook route + signature verification.
- **`outreach_ledger` watch** for "unexpected live send" needs the new server-side `audit_log` / approval record proposed in `OBSERVABILITY_REPORT.md` to define "approved".
- Route all P1/P2 to a real pager once on-call is populated (see `INCIDENT_RESPONSE_RUNBOOK` — currently placeholders).

---

## Verdict

**Alerting: FAIL.** Zero alerts implemented; required security and availability alerts have no signal source. Clears to PASS only after the catalogue above is implemented, a notification channel + on-call rotation are wired, and the underlying metrics/error-tracking/audit-log signals (per `OBSERVABILITY_REPORT.md`) exist.

### Blockers
1. Access to deployed Vercel/Supabase to confirm no out-of-repo alerts exist and to configure rules.
2. Observability backend decision (provides the signals).
3. On-call + pager integration + real contacts.
4. Provider webhook setup (Resend/SendGrid) for bounce/complaint signals.
