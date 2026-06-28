# Hermes Sourcing — Production Deployment Guide

This guide covers the security, infrastructure, and operational steps required to run Hermes Sourcing in production beyond the local demo.

## 1. Pre-flight security checklist

- [ ] **Supabase project** is provisioned and migrations in `supabase/migrations/` are applied in order.
- [ ] **RLS policies** are active: `workspace_state`, `api_keys`, `email_connections`, and `outreach_ledger` are scoped to the workspace; only service-role reads secrets.
- [ ] **Admin role** is enforced: server-side `requireAdmin` protects all key/connection/seat mutations.
- [ ] **Microsoft Entra / Supabase Auth** is configured so the middleware can gate routes.
- [ ] **ALLOWED_EMAIL_DOMAIN** is set to restrict sign-in to the company domain (optional but recommended).
- [ ] **HERMES_API_URL** points to a private/internal hermes-agent instance; it is SSRF allow-listed.
- [ ] **HERMES_API_KEY** is a strong random token, stored server-side only.
- [ ] **OAuth credentials** (`GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET`) are server-side only; redirect URIs are registered exactly.
- [ ] **SendGrid / Resend API keys** are server-side env vars; not exposed to the browser.
- [ ] **Domain verification** (SPF/DKIM/DMARC) is completed before any seat is flipped to `live`.
- [ ] **LinkedIn** is configured for assisted-manual only unless a signed **LinkedIn Recruiter System Connect** partnership exists.

## 2. Environment variables

Copy `.env.local.example` to `.env.local` and fill in at least:

```bash
# Supabase (required for live mode)
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN=yourcompany.com

# Hermes runtime (required for live AI drafts)
HERMES_API_URL=http://127.0.0.1:8642
HERMES_API_KEY=<strong-random-token>

# Email OAuth (required for Gmail / Microsoft Graph live sends)
GOOGLE_CLIENT_ID=<...>
GOOGLE_CLIENT_SECRET=<...>
GOOGLE_REDIRECT_URI=https://<app>/auth/google/callback
MICROSOFT_CLIENT_ID=<...>
MICROSOFT_CLIENT_SECRET=<...>
MICROSOFT_REDIRECT_URI=https://<app>/auth/microsoft/callback

# Transactional email providers (optional)
RESEND_API_KEY=re_...
SENDGRID_API_KEY=SG...
```

## 3. Build & deploy

```bash
npm install
npm run typecheck
npm run lint
npm run test
npm run build
```

Deploy the `.next` output to your hosting target (Vercel, self-hosted Node, Docker, etc.). The app is a standard Next.js 14 App Router application.

## 4. Operational notes

- **Demo mode** — if Supabase env vars are missing, the app runs entirely in the browser with `localStorage` persistence and never sends live data.
- **Dry-run default** — even in live mode, outreach remains dry-run until a seat is live, domain-verified, and `confirmLive` is true.
- **Human approval gate** — all generated outreach must be approved in the UI before it is scheduled or sent.
- **Rate limits** — per-seat daily caps, warm-up ramps, send windows, and jitter are enforced by `src/lib/fleet.ts` and the `claim_and_record` Postgres RPC.
- **Suppression / de-dupe** — the `outreach_ledger` is the single source of truth; a candidate cannot be re-contacted inside the configured window.
- **Audit trail** — every approval, rejection, PII reveal, and live send is written to `activities` and `outreach_ledger`.

## 5. LinkedIn compliance

Hermes Sourcing does **not** automate LinkedIn logins, scraping, or unsolicited bulk DMs. That violates LinkedIn's User Agreement and Recruiter terms and will get accounts banned.

Supported LinkedIn paths:
1. **Assisted-manual** (default) — Hermes drafts the message; a human copies it, opens the candidate's profile, pastes/sends, and confirms in the UI.
2. **LinkedIn Recruiter System Connect (RSC)** — only available with a LinkedIn partnership agreement and RSC OAuth credentials. Wire the `int_linkedin_rsc` integration when credentials are provided.

## 6. Monitoring & incident response

- Watch structured logs from `src/lib/providers.ts`, `src/lib/api/hermes-proxy.ts`, and the outreach send route.
- Alert on: bounce rate > 5%, complaint rate > 0.1%, seat health auto-pause, Hermes runtime unreachable, failed OAuth refreshes.
- Run the security audit test regularly: `npm run test` includes `tests/security-audit.mts`.

## 7. Backups & data retention

- Supabase provides managed backups for Postgres state.
- Candidate PII should be anonymized or deleted on request via the candidate drawer (GDPR/CCPA).
- Retention windows for the ledger and activities are configured in fleet settings.
