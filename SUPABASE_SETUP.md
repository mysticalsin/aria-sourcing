# Backend setup — Supabase + Microsoft (Entra) login

Hermes runs in two modes:

- **Demo mode** (default) — no env vars. State lives in `localStorage`, no login.
- **Live mode** — set the Supabase env vars below. State persists to Supabase in a
  shared **org workspace** (scoped by email domain via RLS), and the whole console
  is gated behind **Microsoft sign-in**.

Switching modes is just env vars + the SQL migration — no code changes.

---

## 1. Create the Supabase project

1. Create a project at <https://supabase.com/dashboard>.
2. **Project Settings → API** — copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server-only)
3. Paste them into `.env.local` (copy from `.env.local.example`).

## 2. Run the schema

Open **SQL Editor** and run, in order:
1. [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) —
   `workspaces`, `profiles`, `workspace_state`, RLS, `ensure_workspace()`.
2. [`supabase/migrations/0002_fleet.sql`](supabase/migrations/0002_fleet.sql) —
   `agent_seats`, `suppression_list`, `outreach_ledger` (with the
   one-active-contact-per-candidate unique index) and the **`claim_and_record()`**
   RPC that enforces suppression + re-contact window + per-seat daily cap
   atomically server-side (the anti-double-contact / anti-ban guarantee).
3. [`supabase/migrations/0003_api_keys.sql`](supabase/migrations/0003_api_keys.sql) —
   `api_keys` table with column-level grants so secrets stay server-side.
4. [`supabase/migrations/0004_email_connections.sql`](supabase/migrations/0004_email_connections.sql) —
   `email_connections` table for Gmail / Microsoft Graph OAuth tokens, also with
   column-level grants and admin-only RLS.
5. [`supabase/migrations/0005_rls_tenant_isolation.sql`](supabase/migrations/0005_rls_tenant_isolation.sql) —
   **Required security hardening — do not skip.** Adds the `WITH CHECK` clause to
   the `workspace_state` UPDATE policy (stops a tenant re-pointing a row to another
   workspace), revokes `anon`, and role-gates every fleet write. Without it,
   0001–0002 leave a cross-tenant RLS gap.

> Run **every** migration in order, through 0005. `supabase db push` /
> `supabase start` / `supabase db reset` apply them all automatically; if you run
> them by hand in the SQL Editor, do not stop before 0005.

**Email sending (optional, live):**
- API-key providers: set `RESEND_API_KEY` or `SENDGRID_API_KEY` in `.env.local`.
- OAuth providers (Gmail / Microsoft Graph): configure the OAuth apps below, then
  connect each seat in **Settings → Fleet**. A real send only happens when a fleet
  seat is set **live** with a **verified domain** and the send is explicitly
  confirmed — otherwise everything is dry-run.
- LinkedIn is assisted-manual only — no automation or scraping.

## 3. Register the Microsoft (Entra) app

In the **Azure Portal → Microsoft Entra ID → App registrations → New registration**:

1. **Name:** `Hermes Sourcing`.
2. **Supported account types:** pick one:
   - *Single tenant* — only your organization (recommended for an internal tool).
   - *Multitenant* — any work/school account.
3. **Redirect URI** (type **Web**):
   `https://<your-project-ref>.supabase.co/auth/v1/callback`
   (find the exact value in Supabase → Authentication → Providers → Azure.)
4. After creating: copy the **Application (client) ID** and the **Directory
   (tenant) ID**.
5. **Certificates & secrets → New client secret** → copy the secret **value**.
6. **API permissions** → Microsoft Graph → delegated: `openid`, `email`,
   `profile`, `offline_access` → *Grant admin consent*.

## 4. Enable Azure in Supabase

Supabase → **Authentication → Providers → Azure**:

- **Enable** the provider.
- **Client ID** = Application (client) ID from Azure.
- **Secret** = the client secret value.
- **Azure Tenant URL** (for single-tenant):
  `https://login.microsoftonline.com/<tenant-id>`
- Save.

Supabase → **Authentication → URL Configuration**:

- **Site URL:** `http://localhost:3000` (dev) / your production URL.
- **Redirect URLs:** add `http://localhost:3000/auth/callback` and your
  production `/auth/callback`.

> The app requests the `azure` provider via Supabase Auth and finishes the
> handshake at `/auth/callback`. The redirect URI registered in **Azure** is the
> Supabase callback (`…supabase.co/auth/v1/callback`); the **app** redirect URL
> registered in **Supabase** is `…/auth/callback`.

## 5. (Optional) Gmail OAuth

For **Gmail API** seats:

1. Go to <https://console.cloud.google.com/apis/credentials>.
2. Create an **OAuth client ID** (Web application).
3. Add authorized redirect URI: `http://localhost:3000/auth/google/callback`
   (and your production equivalent).
4. Enable the **Gmail API**.
5. Copy **Client ID** → `GOOGLE_CLIENT_ID` and **Client secret** → `GOOGLE_CLIENT_SECRET`.

## 6. (Optional) Microsoft Graph OAuth

For **Microsoft Graph** seats (sending via Outlook/Exchange Online):

1. In **Azure Portal → Microsoft Entra ID → App registrations → New registration**.
2. Add a **Web** redirect URI: `http://localhost:3000/auth/microsoft/callback`
   (and your production equivalent).
3. **API permissions** → Microsoft Graph → delegated:
   `Mail.Send`, `User.Read`, `offline_access` → *Grant admin consent*.
4. Copy **Application (client) ID** → `MICROSOFT_CLIENT_ID`.
5. **Certificates & secrets → New client secret** → copy value to `MICROSOFT_CLIENT_SECRET`.

## 7. (Optional) restrict to your domain

Set `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN=yourcompany.com`. Everyone signing in from
that domain lands in the **same shared workspace** automatically
(`ensure_workspace()` keys the workspace by email domain). For hard enforcement,
use single-tenant in Azure and/or Supabase auth hooks.

## 6. Run

```bash
npm install
npm run dev
```

Visit `http://localhost:3000` → you’ll be redirected to **/login** → *Continue
with Microsoft*. After sign-in, your workspace is created and seeded with the
synthetic demo data on first load; every action thereafter is persisted to
Supabase and shared with teammates on your domain.

---

## How persistence works

The app keeps its working state in memory (the React store) and persists the full
state document to `workspace_state.state` (JSONB), debounced, on every change —
so the audit trail, campaigns, candidates, outreach, replies, bookings, and
reports are all tracked server-side and shared across the org via RLS.

The domain types in `src/lib/types.ts` map 1:1 to a normalized schema if you later
want per-table rows (e.g. `candidates`, `outreach_messages`, `activities`). The
document model is the fast, safe default; normalize when you need SQL analytics.

**Security notes:** mock integrations stay mock; the service-role key is never
shipped to the browser; RLS denies cross-workspace reads by default; outreach
remains dry-run regardless of mode.
