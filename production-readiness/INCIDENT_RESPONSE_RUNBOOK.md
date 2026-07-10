# Incident Response Runbook — Hermes Sourcing

> SUPERSEDED by `STATUS.md` 2026-07-10 for current release posture. Historical 2026-06-27 evidence may contain stale stack versions, suite counts, migration ranges, and verdicts.


**App:** Hermes Sourcing (MSourcing)
**Stack:** Next.js 14 App Router · Supabase · Vercel · Microsoft Entra · GDPR-applicable (EU candidate PII)
**Last updated:** 2026-06-27 (Phase 11 observability review)

---

> ## ⚠️ Detection & forensics status — audit 2026-06-27 (Gate 11 = FAIL)
>
> Read this before relying on the runbook below.
> - **No automated detection is implemented.** The "Automated signals" table in §1 is a
>   **design target, not a running system** — there is no alerting, no metrics, no error-tracking,
>   and no synthetic monitor (verified against the code/config tree; see `ALERTING_REPORT.md`).
>   In practice, **detection is manual** (user report or someone tailing Vercel logs) until the
>   `OPERATIONS_RUNBOOK §0` observability stack is built.
> - **On-call contacts are placeholders** (`<name>`). Populate them and wire a pager before go-live.
> - **Forensics are limited.** There is **no durable server-side audit log** for sensitive/admin
>   actions; the in-app "activities" feed is client-written and client-mutable (not trustworthy
>   for an investigation). API-key deletions and role changes leave no record. Useful server-side
>   evidence is limited to `outreach_ledger` (sends), Supabase auth logs, and ephemeral Vercel
>   function logs (retention **UNKNOWN** — preserve them immediately per §4). Logs also contain
>   candidate PII — handle log exports as personal data.
> - During a deploy-correlated incident, **rollback first** (`ROLLBACK_RUNBOOK.md`) — you cannot
>   rely on metrics to confirm impact.
>
> See `OBSERVABILITY_REPORT.md` and `ALERTING_REPORT.md`.

---

## Severity definitions

| Severity | Definition | Response SLA | Examples |
|---|---|---|---|
| **P1 — Critical** | Production is down or data is at risk of loss or unauthorized disclosure | Acknowledge ≤ 15 min; resolve ≤ 2 h | Auth bypass, live outreach sending without approval, PII exposed to wrong tenant, complete outage |
| **P2 — High** | Core functionality is broken for all users; potential data risk | Acknowledge ≤ 30 min; resolve ≤ 4 h | Supabase unreachable, Hermes proxy down, all login attempts failing, outreach_ledger corruption |
| **P3 — Medium** | Significant feature degraded but workaround exists; no data risk | Acknowledge ≤ 2 h; resolve ≤ 24 h | Gmail/Graph OAuth tokens failing for some seats, floor rendering broken, key vault test endpoint returning 500 |
| **P4 — Low** | Minor degradation; cosmetic or non-critical feature | Acknowledge ≤ 24 h; resolve next sprint | Dry-run badge missing, recharts rendering glitch, slow load on `/floor` 3D |

A P1 involving potential personal data exposure ALSO triggers the GDPR breach notification process (Section 6 of this runbook).

---

## 1. Detect

### Automated signals (configure before going live)

> **NOT IMPLEMENTED as of 2026-06-27.** None of the signals below are wired to any alert today
> (no metrics/error-tracking/alert integration exists — see `ALERTING_REPORT.md` for the build
> list). This is the target catalogue. Until built, rely on "Manual detection" below.

| Signal | Threshold | Action |
|---|---|---|
| HTTP 5xx rate on `/api/*` | > 1% over 5 min | P2 alert |
| Auth failure rate (`/auth/callback`) | > 10 failures / min | P2 alert |
| Email bounce rate per seat | > 5% | P2 — auto-pause seat |
| Email complaint rate per seat | > 0.1% | P1 — auto-pause seat + alert |
| Hermes proxy (`/api/hermes/chat`) response time | > 10 s p99 | P3 alert |
| Supabase connection errors | Any sustained burst | P2 alert |
| Failed OAuth token refresh (Gmail / Microsoft Graph) | Consecutive failures for a seat | P3 alert |
| `claim_and_record()` RPC error rate | Any | P2 — outreach suppression may be broken |

### Manual detection

- User reports via support channel
- On-call engineer notices anomaly in Vercel Function logs
- Supabase dashboard alert (Project → Logs → API / Postgres)

---

## 2. Triage

When an alert or report arrives, the on-call engineer runs this checklist within the P1/P2 SLA:

```
1. What is broken? (auth / outreach / floor / fleet / key vault / DB / other)
2. Scope: all users or one workspace / one seat / one browser?
3. When did it start? (correlate with last Vercel deploy timestamp)
4. Was a deploy or migration just run? (check Vercel → Deployments; check Supabase → Logs)
5. Is real outreach in flight that must be stopped immediately?
6. Is there evidence of unauthorized access or data exposure?
```

Assign severity. For P1: immediately page the backup engineer.

---

## 3. Contain

### Outreach — emergency stop

If live outreach may be sending incorrectly or without approval:

1. In **Settings → Fleet**, set all live seats to **dry-run** immediately.
2. This prevents new sends. In-flight sends that have already left the send queue cannot be recalled.
3. Log the seat IDs that were paused and the UTC timestamp.

```sql
-- Verify outreach_ledger for unexpected recent sends:
SELECT contact_email, seat_id, sent_at, provider
FROM public.outreach_ledger
WHERE sent_at > now() - interval '30 minutes'
ORDER BY sent_at DESC;
```

### Auth — lock down the app

If auth is compromised (e.g., RLS bypass, cross-tenant data access):

1. Rotate `SUPABASE_SERVICE_ROLE_KEY` immediately (Supabase → Project Settings → API → Regenerate).
2. Rotate `HERMES_API_KEY` (update in Vercel env vars and redeploy).
3. Revoke active sessions in Supabase → Authentication → Users (sign out all users).
4. Redeploy with new keys via `vercel --prod`.

### Rollback trigger

If the incident correlates with a recent deploy, initiate rollback per the ROLLBACK_RUNBOOK.md immediately. Do not wait for root-cause analysis.

---

## 4. Investigate

### Vercel Function logs

```bash
vercel logs --prod hermes-sourcing --since 1h
# Filter to errors:
vercel logs --prod hermes-sourcing --since 1h | grep -E '"statusCode":[45][0-9]{2}'
```

Key routes to check:
- `POST /api/hermes/chat` — LLM proxy; look for SSRF attempts, 401 cascades
- `GET/POST/DELETE /api/keys` — key vault; look for unauthorized access (should all return 401/403 for non-admin)
- `POST /api/outreach/send` — outreach dispatch; any sends without prior approval are a P1

### Supabase logs

1. Supabase → **Logs → API** — filter by `status >= 400`
2. Supabase → **Logs → Postgres** — look for RLS policy violations or failed `claim_and_record()` calls
3. Supabase → **Authentication → Logs** — failed sign-ins, token refresh failures

### RLS integrity check (run during any data-access incident)

```sql
-- Confirm RLS is on:
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = false;
-- Must return 0 rows

-- Spot-check cross-workspace isolation (run as authenticated, not service role):
-- Should return 0 rows if workspace isolation is intact:
SELECT id FROM public.workspace_state
WHERE workspace_id != public.current_workspace_id();
```

### Identify the blast radius

```sql
-- How many candidates / emails are in the workspace?
SELECT count(*) FROM public.outreach_ledger;

-- How many live seats exist?
SELECT count(*) FROM public.agent_seats WHERE status = 'live';

-- Check suppression list integrity:
SELECT count(*) FROM public.suppression_list;
```

---

## 5. Resolve and verify

1. Apply fix (code change → deploy, or DB fix, or env var change + redeploy).
2. Run the full smoke check from DEPLOYMENT_RUNBOOK.md §5.
3. Run `npm run test:security` locally against a staging environment to confirm security properties held.
4. Confirm outreach is back in dry-run mode if it was paused — only restore live mode for seats where it was previously authorized.
5. Confirm the `claim_and_record()` RPC is functioning (re-contact suppression back in effect).

---

## 6. GDPR breach notification (personal data incidents)

Hermes Sourcing processes EU candidate PII (name, email, contact history, outreach records). Any incident involving unauthorized access, disclosure, or loss of this data triggers GDPR Article 33/34 obligations.

### 72-hour clock starts at: the moment you have reasonable grounds to believe a personal data breach occurred — not after full investigation.

### 6a. Assess whether GDPR applies

A GDPR-notifiable breach is one that is likely to result in risk to individuals' rights and freedoms. Examples:

| Incident | Notifiable? |
|---|---|
| Candidate PII exposed to a different org's workspace (RLS bypass) | YES — P1 |
| Outreach sent to candidates without proper authorization | Likely YES — assess risk to individuals |
| Unauthorized external access to `email_connections` (OAuth tokens) | YES |
| Outreach_ledger read by wrong authenticated user (same org) | Depends on severity — assess |
| Vercel build log containing a leaked service-role key | YES — key must be rotated; assess data accessed |
| Server error that returned no user data | NO |

### 6b. Mandatory steps within 72 hours

**Hour 0 (as soon as breach is suspected):**
- [ ] Declare the incident in your incident log. Note UTC timestamp of discovery.
- [ ] Assign a DPO or breach coordinator (the accountable person for this notification).
- [ ] Contain the breach (Step 3 above).

**Hour 0–24 (preliminary assessment):**
- [ ] Identify: what data was affected? (categories: names, emails, outreach history, OAuth tokens)
- [ ] How many individuals are affected?
- [ ] What was the likely cause?
- [ ] Is the breach ongoing or contained?
- [ ] Preserve all logs (Vercel, Supabase) — do not rotate or delete until investigation is complete.

**Hour 0–72 (notification to supervisory authority, if required):**

Notify your lead supervisory authority (the data protection authority in the EU member state where your main establishment is located) if the breach is likely to result in risk to individuals.

Notification must include:
1. Nature of the breach (categories and approximate number of data subjects and records).
2. Name and contact of DPO or breach coordinator.
3. Likely consequences of the breach.
4. Measures taken or proposed to address the breach and mitigate effects.

If full information is not available within 72 hours, submit an initial notification and follow up with supplementary information. Document the reason for delay.

**Article 34 — Notify affected individuals directly if the breach is likely to result in HIGH risk:**

High-risk indicators for this app:
- Candidate email addresses or contact history exposed to a third party.
- OAuth tokens (Gmail / Microsoft Graph) for individual users leaked.
- Outreach sent on behalf of candidates without their knowledge or consent.

Individual notification must be in plain language and describe:
- Nature of the breach.
- Contact details of the coordinator.
- Likely consequences.
- Steps taken to address the breach and any steps the individual can take to protect themselves.

### 6c. Breach log entry (required under GDPR Article 33(5))

Record the following for every incident, even ones not requiring external notification:

```
Date/time of discovery:
Date/time of containment:
Nature of breach:
Categories of personal data affected:
Approximate number of data subjects:
Approximate number of records:
Likely consequences:
Measures taken:
Reported to supervisory authority? Y/N — if Y, timestamp + reference number
Individuals notified? Y/N — if Y, timestamp + method
DPO/coordinator name:
```

---

## 7. Post-incident review

Conduct within 5 business days of resolution.

- Timeline reconstruction (when detected, when contained, when resolved).
- Root cause analysis.
- What controls failed or were absent?
- What monitoring/alerting would have caught this sooner?
- Action items with owners and due dates.
- Update this runbook with any new signals or steps learned.

Post the post-mortem to the team shared space. Link it from the incident log.

---

## On-call contacts

Replace with real names and contacts before going live.

| Role | Contact | Escalation trigger |
|---|---|---|
| Primary on-call | `<name>` — `<slack/phone>` | First point of contact for all alerts |
| Backup on-call | `<name>` — `<slack/phone>` | P1 or primary unreachable after 15 min |
| DPO / breach coordinator | `<name>` — `<email>` | Any potential personal data breach |
| Supabase support | support.supabase.com (Pro/Team plan) | DB-layer issues beyond team expertise |
| Vercel support | vercel.com/support | Vercel infrastructure issues |

---

## Quick-reference: P1 first 15 minutes

```
00:00  Incident detected / reported
00:02  Acknowledge in team channel: "[P1 OPEN] <description> — investigating"
00:05  Triage: is outreach sending? is auth compromised? is PII exposed?
00:08  Contain: pause all live seats if outreach at risk; rotate keys if auth compromised
00:10  Page backup on-call if not already engaged
00:12  Start GDPR clock if personal data is involved
00:15  Status update in team channel with current findings and next action
```
