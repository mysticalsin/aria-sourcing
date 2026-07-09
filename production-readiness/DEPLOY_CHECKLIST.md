# Hermes Sourcing — Go-Live Checklist

Ordered. Complete each step in sequence. Do not flip any fleet seat to `live`
until every item above it is checked. Items marked **(optional)** are not
required for launch but must be done before the relevant feature is used.

---

## Phase 1 — Pre-flight (local, before touching production)

- [ ] `npm ci && npm run typecheck` — zero TypeScript errors.
- [ ] `npm run lint` — clean.
- [ ] `npm run test` — full deterministic suite passes.
- [ ] `npm run build` (CI or unsynced checkout) or `npm run build:isolated`
      (OneDrive checkout) — production build succeeds locally.
- [ ] Confirm `.env.production.example` is complete and `.env.local` (or
      Vercel env vars) matches every variable listed there.
- [ ] Confirm no secrets are committed to git (`git log --all -S "supabase.co"`
      should return nothing sensitive).

---

## Phase 2 — Supabase provisioning

- [ ] Create a **new Supabase project** at https://supabase.com/dashboard.
      Choose the region closest to your users (e.g. `eu-central-1` for Europe).
- [ ] From **Project Settings → API**, copy:
  - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
  - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`
- [ ] Run migrations in order via **SQL Editor** (or `supabase db push`):
  1. `supabase/migrations/0001_init.sql` — workspaces, profiles,
     workspace_state, RLS, `ensure_workspace()`.
  2. `supabase/migrations/0002_fleet.sql` — agent_seats, suppression_list,
     outreach_ledger, `claim_and_record()` RPC.
  3. `supabase/migrations/0003_api_keys.sql` — api_keys table with
     column-level grants (secrets server-side only).
  4. `supabase/migrations/0004_email_connections.sql` — email_connections
     table for Gmail / Microsoft Graph OAuth tokens.
  5. `supabase/migrations/0005_rls_tenant_isolation.sql` — hardened tenant
     grants and RLS policies.
  6. `supabase/migrations/0006_outreach_approvals.sql` through
     `0008_human_outbound_approvals.sql` — durable approval records and human
     provenance.
  7. `supabase/migrations/0009_whatsapp_delivery_policy.sql` and
     `0010_whatsapp_delivery_reconciliation.sql` — consent/template/window
     policy plus Meta acceptance and receipt audit history.
  8. `supabase/migrations/0011_outreach_approval_lifecycle.sql` and
     `0012_email_unsubscribe.sql` — authoritative revoke/claim lifecycle and
     opaque one-click unsubscribe hashes.
  9. `supabase/migrations/0013_outreach_approval_race_safety.sql` — one lock
     order for approve, revoke, and dispatch; retry-safe WhatsApp claims.
  10. `supabase/migrations/0014_whatsapp_review_and_inbound_recovery.sql` and
      `0015_whatsapp_webhook_late_event_safety.sql` — durable human review,
      inbound recovery, and late-receipt safety.
- [ ] Verify RLS is active for every table: in the SQL Editor, run
      `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';`
      — every row must show `rowsecurity = true`.
- [ ] Verify the `claim_and_record()` RPC exists:
      `SELECT proname FROM pg_proc WHERE proname = 'claim_and_record';`

---

## Phase 3 — Microsoft Entra (SSO, required for live mode)

- [ ] In **Azure Portal → Entra ID → App registrations**, create a new
      registration named `Hermes Sourcing`.
- [ ] Set **supported account types** to *single tenant* (your org only).
- [ ] Set **redirect URI** (Web) to the Supabase callback:
      `https://<project-ref>.supabase.co/auth/v1/callback`
      (find the exact value in Supabase → Authentication → Providers → Azure).
- [ ] Copy **Application (client) ID** and **Directory (tenant) ID**.
- [ ] **Certificates & secrets → New client secret** — copy the secret value
      immediately (shown once).
- [ ] **API permissions** → Microsoft Graph → delegated: `openid`, `email`,
      `profile`, `offline_access` → Grant admin consent.
- [ ] In Supabase → **Authentication → Providers → Azure**: enable, paste
      Client ID and Secret, set Tenant URL to
      `https://login.microsoftonline.com/<tenant-id>`.
- [ ] In Supabase → **Authentication → URL Configuration**:
  - Site URL: `https://your-app.vercel.app`
  - Redirect URLs: add `https://your-app.vercel.app/auth/callback`

---

## Phase 4 — (Optional) Gmail OAuth

- [ ] In Google Cloud Console → **APIs & Services → Credentials**, create an
      OAuth 2.0 Client ID (Web application).
- [ ] Add authorized redirect URI:
      `https://your-app.vercel.app/auth/google/callback`
- [ ] Enable the **Gmail API** in the project.
- [ ] Copy Client ID → `GOOGLE_CLIENT_ID`, Client Secret → `GOOGLE_CLIENT_SECRET`.
- [ ] Set `GOOGLE_REDIRECT_URI=https://your-app.vercel.app/auth/google/callback`.

---

## Phase 5 — (Optional) Microsoft Graph OAuth for Outlook seats

- [ ] Register a second (or reuse the Entra) app in **Azure → App registrations**.
- [ ] Add Web redirect URI:
      `https://your-app.vercel.app/auth/microsoft/callback`
- [ ] **API permissions** → Microsoft Graph → delegated:
      `Mail.Send`, `User.Read`, `offline_access` → Grant admin consent.
- [ ] Copy Application client ID → `MICROSOFT_CLIENT_ID`.
- [ ] Create a new client secret → `MICROSOFT_CLIENT_SECRET`.
- [ ] Set `MICROSOFT_REDIRECT_URI=https://your-app.vercel.app/auth/microsoft/callback`.

---

## Phase 6 — Environment variables (Vercel)

- [ ] In Vercel → **Settings → Environment Variables**, add every variable
      from `.env.production.example` for the **Production** environment.
- [ ] Confirm `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` is set to your company domain
      (e.g. `yourcompany.com`) — this disables the demo mode bypass and
      restricts sign-in to your org.
- [ ] Confirm `HERMES_API_KEY` is a freshly generated random token
      (`openssl rand -hex 32`), not the placeholder value.
- [ ] If Hermes is enabled, set `HERMES_RUNTIME_WORKSPACE_ID` to the one
      workspace assigned to that dedicated runtime and prove a second workspace
      receives 403 without any upstream call.
- [ ] Confirm `SUPABASE_SERVICE_ROLE_KEY` is set as a **Secret** (encrypted,
      not plain text) in Vercel and is absent from all browser-exposed env vars.
- [ ] Set `DATA_ENCRYPTION_KEY`, `CRON_SECRET`, and the canonical HTTPS
      `OUTREACH_UNSUBSCRIBE_BASE_URL` before enabling a live email seat.
- [ ] To enable the public careers site, set the server-only
      `CAREERS_WORKSPACE_ID` to the intended workspace UUID. Leave it unset
      until that workspace has only compliance-passed, published job ads.
- [ ] If WhatsApp is enabled, set `WHATSAPP_TOKEN`,
      `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, and
      `WHATSAPP_APP_SECRET`; register `/api/webhooks/whatsapp` in Meta.
- [ ] Do not enable SMS: the product intentionally blocks all live SMS delivery
      until its consent and durable-dispatch policy exists.
- [ ] Remove or leave blank `RESEND_API_KEY` / `SENDGRID_API_KEY` if you are
      not yet ready to enable live email — all sends default to dry-run when
      absent.

---

## Phase 7 — Deploy

- [ ] Push the production branch to Vercel (or trigger a manual deploy).
- [ ] Confirm `vercel.json` `regions` is set to the correct edge region for
      your users (`cdg1` = Paris; adjust if your users are elsewhere).
- [ ] Confirm the Vercel build log shows zero TypeScript errors and the
      `npm run build` step completes successfully.
- [ ] Confirm the deployment URL matches the Site URL and Redirect URL
      registered in Supabase and Azure.

---

## Phase 8 — Smoke test (post-deploy)

- [ ] Visit `https://your-app.vercel.app` — confirm redirect to `/login`.
- [ ] Sign in with a corporate Microsoft account — confirm redirect to the
      main console (workspace auto-created by `ensure_workspace()`).
- [ ] Confirm the workspace header shows your domain and the correct user.
- [ ] Open **Settings → API Keys** — confirm the server-side key vault loads
      without errors (no service-role key leak to the browser).
- [ ] Create a sourcing role and run one dry-run outreach cycle — confirm the
      activity log records the approval step and no real email is sent.
- [ ] Confirm `/api/hermes` responds (or returns an appropriate error) without
      leaking secrets in the response body.
- [ ] Verify the CSP header is present on all routes:
      `curl -I https://your-app.vercel.app | grep -i content-security-policy`

---

## Phase 9 — Email domain verification (before any live send)

- [ ] Complete **SPF**, **DKIM**, and **DMARC** DNS record setup for every
      domain that will appear as `from:` in outreach.
- [ ] Verify domain in your email provider dashboard (Resend / SendGrid).
- [ ] Confirm bounce rate monitoring is in place — auto-pause a seat if bounce
      rate exceeds 5 % or complaint rate exceeds 0.1 %.
- [ ] Send a controlled email and inspect raw headers for `List-Unsubscribe` and
      `List-Unsubscribe-Post`; submit the one-click request and prove the next
      send to that address is blocked by `suppression_list`.
- [ ] Only after verification: flip the target fleet seat to `live` in
      **Settings → Fleet** and set the domain-verified flag.

---

## Phase 10 — Monitoring and alerting

- [ ] Enable **Supabase log drains** or connect to your logging platform
      (Datadog, Axiom, Grafana Cloud, etc.).
- [ ] Set up Vercel **Function Log** alerts for 5xx errors and timeouts on
      `/api/hermes` and `/api/outreach`.
- [ ] Create alerts for:
  - Hermes runtime unreachable (`HERMES_API_URL` health check fails).
  - Failed OAuth token refresh (Gmail / Microsoft Graph connection drops).
  - Seat auto-paused by the fleet health monitor.
  - `claim_and_record()` suppression hits spiking unexpectedly.
- [ ] Confirm Supabase **point-in-time recovery** or daily backup schedule is
      enabled for the project (Supabase Pro required).
- [ ] Document the on-call rotation and link the runbook in your incident
      management tool.

---

## Phase 11 — Compliance sign-off

- [ ] Legal/privacy review of GDPR applicability for EU candidate PII stored
      in `workspace_state`.
- [ ] Confirm candidate PII anonymization/deletion flow works end-to-end (via
      the candidate drawer) before processing real candidates.
- [ ] Confirm LinkedIn usage is restricted to **assisted-manual** mode only,
      unless a signed LinkedIn Recruiter System Connect (RSC) agreement and
      RSC OAuth credentials are in place.
- [ ] `npm run test:security` — all security suites pass on the production
      build.

---

## Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Engineering lead | | | |
| Security reviewer | | | |
| Data privacy (DPO) | | | |
| Business owner | | | |

Go-live is authorized only when all Phase 1–11 items are checked and this
table is signed.
