# Operations Runbook — Hermes Sourcing

> SUPERSEDED by `STATUS.md` 2026-07-10 for current release posture. Historical 2026-06-27 evidence may contain stale stack versions, suite counts, migration ranges, and verdicts.


**App:** Hermes Sourcing (MSourcing)
**Stack:** Next.js 14 App Router · Supabase · Vercel · Microsoft Entra
**Last updated:** 2026-06-27 (Phase 11 observability review)

---

> ## ⚠️ Observability & Monitoring status — audit 2026-06-27 (Gate 11 = FAIL)
>
> **The monitoring/alerting referenced in this runbook is NOT YET IMPLEMENTED.** This audit
> verified the current code/config tree and found: no error-tracking, no metrics, no traces,
> no alerting, no synthetic/uptime monitor wired up, no log drain, undefined log retention,
> and no durable server-side audit log for sensitive/admin actions. The in-app "activities"
> feed is a **client-side UI timeline, not a security audit log**. Logs currently contain
> **candidate PII** (recipient emails) — see `OBSERVABILITY_REPORT.md`.
>
> Treat every "configure an external monitor", "check Vercel Analytics", "SLO review", and
> alert-threshold instruction below as a **TODO to build before go-live**, not as a running
> control. Do not assume any of it is active.
>
> Full detail and the build list:
> - `OBSERVABILITY_REPORT.md` — current-state inventory, findings, gate decision.
> - `ALERTING_REPORT.md` — alert catalogue to implement (synthetic checks, error/latency,
>   DB, backup-failure, cert-expiry, auth-anomaly, cost).
> - `BACKUP_RESTORE_REPORT.md` — backup verification depends on manual checks (§1 below).

---

## §0. Observability setup (DO THIS BEFORE GO-LIVE)

Current state: none of the below is implemented (evidence in `OBSERVABILITY_REPORT.md`).
Minimum viable observability before any real candidate data is processed:

1. **Error tracking** — add `@sentry/nextjs` (or equivalent): `instrumentation.ts` + config,
   DSN via env, source-map upload in CI, release = Vercel commit SHA, and a `beforeSend`
   PII scrubber that strips email-shaped strings and provider response bodies.
2. **Synthetic/uptime monitor** (cheapest first win) — Checkly / Better Uptime / Vercel monitor:
   - `GET /login` → expect 200 (app up)
   - `GET /api/health` → expect 200 (liveness; add a deep `/api/health?deep=1` that pings the DB)
   - `GET /api/keys` unauthenticated → expect **401** (auth-gate canary; non-401 = auth bypass = P1)
3. **Metrics** — Vercel Analytics + Speed Insights; emit RED metrics (count/status/duration) per
   `/api/*` route; instrument the SLOs in §5.
4. **Server-side audit log** — add an append-only `audit_log` table written by the service-role
   client for key create/delete/test, role change, seat mode change, send approval, OAuth
   connect/disconnect, suppression edits. (The client "activities" feed does NOT cover this.)
5. **Alert routing** — wire P1/P2 alerts to a pager + on-call channel; populate the on-call
   table in `INCIDENT_RESPONSE_RUNBOOK.md` (currently placeholders).
6. **Log retention** — choose a DPIA-aligned window (e.g. 30–90 days), configure a Vercel log
   drain or Supabase export, and an automatic deletion job; document it here and in the privacy policy.

See `ALERTING_REPORT.md` for the full alert catalogue and thresholds.

---

## Routine operations schedule

| Task | Frequency | Owner | Section |
|---|---|---|---|
| Observability setup (pre-go-live, one-time) | Before go-live | Eng + Ops | §0 |
| Backup verification | Weekly | Ops | §1 |
| API key rotation | Quarterly (or on-demand) | Admin | §2 |
| OAuth token health check | Weekly | Ops | §3 |
| TLS certificate check | Monthly | Ops | §4 |
| Uptime / SLO review | Weekly | Ops | §5 |
| Outreach ledger audit | Monthly | Admin | §6 |
| Dependency security scan | Weekly (CI) / Monthly (manual) | Eng | §7 |
| Suppression list hygiene | Monthly | Admin | §8 |
| GDPR data-retention sweep | Quarterly | Admin + DPO | §9 |
| Security test run | Before each deploy / Monthly | Eng | §10 |

---

## §1. Backup verification (weekly)

Supabase provides managed Postgres backups. This process confirms they exist and are restorable.

### 1a. Confirm backups are enabled

1. Log in to **Supabase Dashboard → <project> → Database → Backups**.
2. Confirm **Daily Backups** is enabled and shows recent entries (within the last 24 hours).
3. Confirm **Point-in-Time Recovery (PITR)** is enabled if on Pro plan or above.

### 1b. Verify backup recency

The most recent backup must be no older than 25 hours. If it is:
- Check Supabase status page (status.supabase.com) for service issues.
- Open a Supabase support ticket if no service issue is reported.

### 1c. Restore drill (quarterly minimum)

Perform a restore drill to a **new, isolated Supabase project** — never to the production project.

```bash
# Supabase dashboard: select the backup timestamp → "Restore to new project"
# Note: this creates a new project with its own URL and keys.
# Do NOT point production Vercel env vars at the restored project.

# After restore, verify the schema:
# 1. Connect to the restored project with psql or the SQL Editor.
# 2. Run:
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
# Expected tables: agent_seats, api_keys, email_connections, outreach_ledger,
#                  profiles, suppression_list, workspace_state, workspaces

# 3. Spot-check row counts:
SELECT 'workspace_state' AS t, count(*) FROM public.workspace_state
UNION ALL SELECT 'outreach_ledger', count(*) FROM public.outreach_ledger
UNION ALL SELECT 'agent_seats', count(*) FROM public.agent_seats;

# 4. Confirm RLS is on all tables:
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = false;
-- Must return 0 rows

# 5. Delete the restored project after the drill is complete.
```

Record the drill outcome in the ops log: date, backup timestamp used, restore time, pass/fail.

---

## §2. API key rotation (quarterly + on-demand)

Hermes Sourcing stores provider API keys (Resend, SendGrid, Hermes agent) server-side in the `api_keys` table via `/api/keys`. Keys in Vercel environment variables (`SUPABASE_SERVICE_ROLE_KEY`, `HERMES_API_KEY`, OAuth secrets) are rotated separately.

### 2a. Rotate a provider API key via the UI

This is the normal path for keys stored in the Supabase key vault:

1. Sign in as an **admin** user.
2. Navigate to **Settings → API Keys** (or `/settings`).
3. Identify the key to rotate (visible by last-4 digits and provider name).
4. Generate a new key from the provider's console (Resend, SendGrid, etc.).
5. Click **Add Key** in Hermes, enter the new key value.
6. Verify the new key with the **Test** button — confirm status shows `valid`.
7. Delete the old key entry using the trash icon.

The `secret` column is never returned to the browser — only `last4`, `name`, `provider`, and `status` are visible. Server-side code reads the full secret via the service-role client.

### 2b. Rotate Vercel environment variables

For `SUPABASE_SERVICE_ROLE_KEY`, `HERMES_API_KEY`, OAuth client secrets:

```bash
# 1. Generate the new value from the relevant console
#    (Supabase / Azure Portal / Google Cloud Console)

# 2. Update in Vercel:
vercel env rm VARIABLE_NAME production
vercel env add VARIABLE_NAME production
# Enter new value when prompted

# 3. Redeploy to pick up the new value:
vercel --prod

# 4. Smoke check (auth + /api/keys test):
curl -sI https://<app>/login | head -n1
# Expect: 200 or 307

# 5. Verify old key is revoked in the originating console
#    (Supabase: Project Settings → API → Regenerate invalidates old key immediately)
```

### 2c. Rotate SUPABASE_SERVICE_ROLE_KEY

This key has full bypass of RLS. Rotate immediately if there is any suspicion of exposure.

```bash
# 1. Supabase → Project Settings → API → service_role → Regenerate
#    The old key is invalidated immediately on regeneration.

# 2. Update in Vercel as per §2b above.

# 3. Redeploy immediately: vercel --prod

# 4. Verify the app is functional (auth flow, key vault POST, DB reads).
```

### 2d. Rotation log entry

Record for every rotation:

```
Date:
Variable / key name:
Reason: (scheduled quarterly / suspected exposure / offboarding / other)
Rotated by:
Verified working: Y/N
Old key revoked in source console: Y/N
```

---

## §3. OAuth token health check (weekly)

Gmail and Microsoft Graph OAuth tokens are stored in `email_connections` (admin-only RLS, `secret` column hidden from authenticated role).

### Check token status per seat

1. Navigate to **Settings → Fleet** (admin only).
2. For each connected Gmail or Microsoft Graph seat, check the connection status badge.
3. Seats showing `expired` or `error` need token refresh.

### Force token refresh

OAuth tokens refresh automatically when a seat attempts to send. If refresh is failing:

```bash
# Check Vercel logs for refresh errors:
vercel logs --prod hermes-sourcing --since 24h | grep -i "refresh_token\|OAuthError\|401"
```

Common causes:
- **Google:** Refresh token expired (> 6 months inactive) → user must re-connect the seat.
- **Microsoft Graph:** Client secret expired in Azure → rotate in Azure Portal and update `MICROSOFT_CLIENT_SECRET` in Vercel.
- **Redirect URI mismatch:** `GOOGLE_REDIRECT_URI` or `MICROSOFT_REDIRECT_URI` in Vercel must match the URI registered in the respective console exactly.

### Re-connect a seat

1. Admin navigates to **Settings → Fleet → <seat> → Connect**.
2. Completes the OAuth flow.
3. New tokens are stored in `email_connections` — old tokens are replaced.

---

## §4. TLS certificate check (monthly)

Vercel manages TLS certificates automatically via Let's Encrypt for all custom domains. They auto-renew 30 days before expiry.

### Verify certificate validity

```bash
# Check expiry (replace with your domain):
echo | openssl s_client -connect <your-domain>:443 -servername <your-domain> 2>/dev/null \
  | openssl x509 -noout -dates
# notAfter must be > 30 days from today

# Quick check via curl:
curl -sv https://<your-domain>/login 2>&1 | grep -E "SSL|certificate|expire"
```

If a certificate is expired or within 7 days of expiry and Vercel has not auto-renewed:

1. Check **Vercel → Project → Settings → Domains** — any error badge on the domain.
2. Confirm DNS records point to Vercel's nameservers / A records correctly.
3. If DNS is correct but cert is not renewing, contact Vercel support.

### Email domain certificates (SPF/DKIM/DMARC)

Before any seat is set to `live`, confirm the sending domain has:
- **SPF** record: `v=spf1 include:<provider> -all` (or appropriate record for Resend/SendGrid)
- **DKIM** key pair published in DNS
- **DMARC** policy: at minimum `v=DMARC1; p=quarantine; rua=mailto:<admin@domain>`

```bash
# Check SPF:
dig TXT <sending-domain> | grep spf

# Check DMARC:
dig TXT _dmarc.<sending-domain>
```

Sending from a domain without these records will result in deliverability failures and may trigger the auto-pause on bounce rate threshold (> 5%).

---

## §5. Uptime and SLO review (weekly)

> **STATUS (2026-06-27): NOT IMPLEMENTED.** No external uptime monitor or metrics backend is
> configured (verified — `package.json` has no analytics/OTel dep; `vercel.json` has no monitor;
> no monitor is wired to `/api/health`). The SLO targets below are **unmeasurable** until §0.3
> metrics are in place. Build §0 first, then this becomes a real weekly review.

### Uptime monitoring

Configure an external uptime monitor (e.g. Vercel Analytics, Better Uptime, Checkly) to probe:

| Endpoint | Method | Expected | Alert on |
|---|---|---|---|
| `https://<app>/login` | GET | HTTP 200 | Non-200 for > 2 min |
| `https://<app>/api/keys` (no auth) | GET | HTTP 401 | Non-401 for > 1 min (means auth gate is broken) |

The `/api/keys` unauthenticated check is a canary for auth middleware health — it must always return 401 when no valid session is present.

### Weekly SLO review checklist

- [ ] Vercel Analytics → Error Rate: less than 0.5% for `4xx` (excluding expected 401s), less than 0.1% for `5xx`
- [ ] Supabase → Dashboard → API request error rate: less than 1%
- [ ] P99 response time for `/api/hermes/chat`: less than 10 seconds
- [ ] No seats in auto-paused state without a known reason
- [ ] No failed backup entries in Supabase → Backups

Record the review outcome in the ops log. Escalate any threshold breach to engineering.

---

## §6. Outreach ledger audit (monthly)

The `outreach_ledger` is the single source of truth for all outreach activity and the deduplication guarantee.

```sql
-- Monthly audit queries (run in Supabase SQL Editor as service role):

-- 1. Total outreach volume by provider and status:
SELECT provider, status, count(*) AS n
FROM public.outreach_ledger
GROUP BY provider, status
ORDER BY n DESC;

-- 2. Check for any sends missing an approval record (should be 0):
-- (This requires an 'approved_at' or similar column if you add approval timestamping)

-- 3. Contacts approached in the last 30 days:
SELECT count(DISTINCT contact_email) AS unique_contacts,
       count(*) AS total_sends
FROM public.outreach_ledger
WHERE sent_at > now() - interval '30 days';

-- 4. Check suppression list is being respected:
-- (Verify no contact appears in both suppression_list and recent outreach_ledger)
SELECT ol.contact_email
FROM public.outreach_ledger ol
JOIN public.suppression_list sl ON ol.contact_email = sl.email
WHERE ol.sent_at > sl.suppressed_at
LIMIT 20;
-- Must return 0 rows; any rows indicate a suppression bypass — P1 incident

-- 5. Per-seat daily cap compliance:
-- (Flag any seat that exceeded its configured daily limit)
SELECT seat_id, sent_at::date AS day, count(*) AS sends_per_day
FROM public.outreach_ledger
GROUP BY seat_id, sent_at::date
HAVING count(*) > 50   -- adjust threshold to match fleet config
ORDER BY sends_per_day DESC
LIMIT 20;
```

Document the audit results. Any suppression bypass is a P1 incident.

---

## §7. Dependency security scan (CI / monthly manual)

### CI gate (every push to main)

The CI pipeline must run:
```bash
npm audit --audit-level=high   # Fail on high/critical CVEs
```

### Monthly manual scan

```bash
cd /path/to/hermes-sourcing

# Full audit with detail:
npm audit

# If vulnerabilities found, attempt auto-fix:
npm audit fix

# For vulnerabilities that require a major version bump:
npm audit fix --force
# Review the diff carefully — major bumps can introduce breaking changes.
# Run npm run typecheck && npm run test after any fix.
```

Key dependencies to watch (high-impact for this app):
- `next` — Next.js core; CVEs here are high severity
- `@supabase/ssr`, `@supabase/supabase-js` — auth and DB client; rotate keys on any CVE
- `zod` — input validation; bypass CVEs are critical
- `three`, `@react-three/fiber`, `@react-three/drei` — 3D rendering (XSS vectors)

---

## §8. Suppression list hygiene (monthly)

The suppression list prevents re-contacting candidates who have opted out or are within the re-contact window.

```sql
-- View suppression list size and age distribution:
SELECT
  date_trunc('month', suppressed_at) AS month,
  count(*) AS suppressions
FROM public.suppression_list
GROUP BY month
ORDER BY month DESC;

-- Check for entries older than your configured retention window:
-- (If your policy is 2-year retention, flag older entries for review)
SELECT count(*) FROM public.suppression_list
WHERE suppressed_at < now() - interval '2 years';
```

Entries older than the configured retention window may be deleted per your GDPR retention policy. Confirm with the DPO before bulk deletion — some suppressions (e.g. opt-outs) should be retained indefinitely.

---

## §9. GDPR data-retention sweep (quarterly)

Hermes Sourcing processes EU candidate PII. The following fields contain personal data:

| Table | PII fields |
|---|---|
| `outreach_ledger` | `contact_email`, message content (if stored) |
| `suppression_list` | `email` |
| `workspace_state` | JSONB blob may contain candidate names, emails, outreach history |
| `email_connections` | OAuth tokens tied to user identities |
| `profiles` | user email, display name |

### Quarterly review tasks

1. **Data subject requests:** Process any erasure or export requests received during the quarter. The candidate drawer in the UI provides per-candidate deletion. Verify deletion cascades to `outreach_ledger` entries.

2. **Retention limits:** For `outreach_ledger` entries beyond your retention period (e.g., 3 years), delete:
```sql
-- REVIEW WITH DPO BEFORE EXECUTING:
DELETE FROM public.outreach_ledger
WHERE sent_at < now() - interval '3 years';
```

3. **workspace_state cleanup:** If a workspace has been inactive for the retention period, confirm whether its data should be purged. The `workspaces` table `created_at` column can help identify stale workspaces.

4. **Subprocessor list:** Confirm your data subprocessor list (Supabase, Vercel, Resend/SendGrid, Google, Microsoft) is current and covered in your privacy policy.

5. **DPIA review:** If material changes were made to data processing (new email provider, new PII field, new data flows), update the DPIA.

---

## §10. Security test suite (before every deploy / monthly)

```bash
# From the repo root:

# Security-specific subset (fast — ~30 seconds):
npm run test:security
# Runs: security-audit, security-redos, rbac-keys, api-validation, guardrails, linkedin-policy

# Full test suite (all 21 suites):
npm run test

# Both must report 0 failures before any production deploy.
```

### What the security tests cover

| Test file | What it validates |
|---|---|
| `tests/security-audit.mts` | SSRF protection on Hermes proxy, auth gating, key vault rules |
| `tests/security-redos.mts` | ReDoS-safe regex on external input in fleet/provider rules |
| `tests/rbac-keys.mts` | RBAC: only admin role can write to key vault |
| `tests/api-validation.mts` | Zod schema enforcement on all `/api/*` routes |
| `tests/guardrails.mts` | Outreach guardrails: approval gate, dry-run default, suppression |
| `tests/linkedin-policy.mts` | LinkedIn automation policy (no scraping, no auto-DM) |

If any of these fail in production context, treat as a P2 incident and do not deploy until fixed.

---

## Ops log template

Keep a running ops log (spreadsheet or Notion table) with one row per task performed:

```
Date | Task | Outcome | Notes | Performed by
2026-06-27 | Backup verification | PASS | Latest backup 18h old | <name>
2026-06-27 | Key rotation — HERMES_API_KEY | PASS | Quarterly rotation | <name>
```
