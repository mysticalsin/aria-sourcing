# Deployment Runbook — Hermes Sourcing

**App:** Hermes Sourcing (MSourcing)
**Stack:** Next.js 16 App Router · React 19 · Supabase (Postgres + Auth) · Microsoft Entra · Vercel
**Last updated:** 2026-07-10

---

## Prerequisites

| Requirement | Where to check |
|---|---|
| Vercel CLI installed (`npm i -g vercel`) | `vercel --version` |
| Supabase CLI installed | `supabase --version` |
| Node 22.x | `node --version` and `package.json` `engines.node` |
| GitHub Actions CI green on `main` | GitHub → Actions tab |
| All required env vars set in Vercel project | Vercel → Project → Settings → Environment Variables |

---

## 1. Pre-deployment gate (run every time)

All checks must pass before a production deploy is triggered. Block the deploy if any fails.

```bash
# From the repo root:
npm run typecheck       # tsc --noEmit; must exit 0
npm run lint            # next lint; must be "No ESLint warnings or errors."
npm run test            # full deterministic suite; 97 suite commands must be 0 failures
npm run test:security   # security-specific subset (faster); must be 0 failures
npm run build           # must complete without error in CI or an unsynced checkout
npm run build:isolated  # required for this OneDrive-synced checkout
```

If the applicable build command fails, do NOT proceed. Fix the build first.

`build:isolated` creates an empty temporary project, copies the build inputs,
installs from the lockfile, clears any inherited `NEXT_DIST_DIR`, and runs the
normal production build. Vercel continues to use `npm run build`; do not set
an absolute `NEXT_DIST_DIR`, because Turbopack rejects output outside the
project root.

---

## 2. Database migrations (Supabase)

Migrations must be applied **before** the new code is live. The migration files live in `supabase/migrations/`. Apply every file in strict numeric order.

### 2a. Check current schema state

```bash
supabase db diff --schema public --linked
```

If the diff is empty, the DB is already at HEAD — skip to step 3.

### 2b. Apply pending migrations

```bash
# Recommended: use the Supabase CLI (linked to your project)
supabase db push

# Alternative: run the SQL files manually in Supabase SQL Editor.
# Order matters. Apply every file below:
# 0001_init.sql → workspaces, profiles, workspace_state, base RLS, ensure_workspace()
# 0002_fleet.sql → agent_seats, suppression_list, outreach_ledger, claim_and_record() RPC
# 0003_api_keys.sql → api_keys, column-level grants for server-side secrets
# 0004_email_connections.sql → email_connections for Gmail/Microsoft OAuth tokens
# 0005_rls_tenant_isolation.sql → hardened tenant grants, anon revoke, role-gated writes
# 0006_outreach_approvals.sql → durable human approval records
# 0007_agent_runtime.sql → agent runtime and durable message ledgers
# 0008_human_outbound_approvals.sql → human approval provenance
# 0009_whatsapp_delivery_policy.sql → consent/template/window dispatch policy
# 0010_whatsapp_delivery_reconciliation.sql → Meta acceptance and receipt audit
# 0011_outreach_approval_lifecycle.sql → approval revoke and atomic email claims
# 0012_email_unsubscribe.sql → opaque one-click unsubscribe token hashes
# 0013_outreach_approval_race_safety.sql → serialized approval/revoke/dispatch lifecycle
# 0014_whatsapp_review_and_inbound_recovery.sql → human review and recoverable inbound work
# 0015_whatsapp_webhook_late_event_safety.sql → late receipt and draft-collision safety
# 0016 intentionally unreleased — gap is deliberate
# 0017_dispatch_concurrency.sql → dispatcher claim concurrency safety
# 0018_first_admin.sql → first-admin bootstrap path
```

**IMPORTANT:** RLS must be enabled on every table listed above. Verify after each migration:

```sql
-- In Supabase SQL Editor, confirm RLS is ON:
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('workspaces','profiles','workspace_state','agent_seats',
                    'suppression_list','outreach_ledger','api_keys','email_connections',
                    'agent_specs','agent_runs','agent_events','messages_outbound',
                    'messages_inbound','whatsapp_contacts','whatsapp_senders',
                    'whatsapp_templates','whatsapp_conversation_windows',
                    'outbound_content_cache','whatsapp_delivery_events');
-- Every row must show rowsecurity = true
```

### 2c. Verify RPC exists

```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'claim_and_record', 'claim_email_outbound', 'claim_whatsapp_outbound',
    'record_outreach_approval', 'revoke_outreach_approval',
    'review_whatsapp_outbound', 'claim_whatsapp_inbound_processing',
    'complete_whatsapp_inbound_processing',
    'record_whatsapp_provider_acceptance', 'record_whatsapp_delivery_event'
  );
-- Must return every named routine.
```

---

## 3. Environment variables

All variables below must be set in Vercel **before** deploying. Production values only — never commit secrets to git.

Minimum live production set: the Supabase trio
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`), `DATA_ENCRYPTION_KEY`, `CRON_SECRET`,
`OUTREACH_UNSUBSCRIBE_BASE_URL`, Google OAuth variables if Gmail seats are used,
Microsoft OAuth variables if Outlook seats are used, and at least one verified
delivery path before any live email is enabled.

| Variable | Scope | Required | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Yes | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Yes | Supabase → Project Settings → API → anon public |
| `SUPABASE_URL` | Server | Optional | Server-side override for the Supabase project URL; defaults to `NEXT_PUBLIC_SUPABASE_URL` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | Yes | Never expose to browser. Supabase → API → service_role |
| `DATA_ENCRYPTION_KEY` | Server | Yes | Base64 32-byte key for provider/OAuth secrets at rest |
| `CRON_SECRET` | Server | Yes for dispatcher | Strong random bearer secret for `/api/cron/dispatch-outbound` |
| `CAREERS_WORKSPACE_ID` | Server | Yes to enable `/careers` | UUID of the single workspace allowed to publish public roles; leave unset to fail closed |
| `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` | Public | Recommended | Locks sign-in to one domain (e.g. `mantu.com`) |
| `NEXT_PUBLIC_ENABLE_DEMO_LOGIN` | Public | No for live prod | Synthetic demo-login escape hatch; keep false/unset in real production |
| `DEMO_SESSION_SECRET` | Server | Required if demo login is enabled | HMAC secret for signed demo sessions |
| `DEMO_ADMIN_PASSWORD` | Server | Required if demo login is enabled | Demo admin password; do not use for real tenants |
| `HERMES_API_URL` | Server | For AI drafts | Internal only; must not be a public internet URL |
| `HERMES_API_KEY` | Server | For AI drafts | Strong random token (≥32 chars) |
| `HERMES_PROXY_SECRET` | Server | If Hermes proxy route is used | Shared secret for proxy calls |
| `HERMES_RUNTIME_WORKSPACE_ID` | Server | Required with Hermes | UUID of the single workspace bound to this dedicated runtime; no shared multi-workspace process |
| `GOOGLE_CLIENT_ID` | Server | If Gmail seats used | |
| `GOOGLE_CLIENT_SECRET` | Server | If Gmail seats used | |
| `GOOGLE_REDIRECT_URI` | Server | If Gmail seats used | `https://<app>/auth/google/callback` |
| `MICROSOFT_CLIENT_ID` | Server | If Graph seats used | |
| `MICROSOFT_CLIENT_SECRET` | Server | If Graph seats used | |
| `MICROSOFT_REDIRECT_URI` | Server | If Graph seats used | `https://<app>/auth/microsoft/callback` |
| `RESEND_API_KEY` | Server | If Resend email used | |
| `SENDGRID_API_KEY` | Server | If SendGrid email used | |
| `OUTREACH_UNSUBSCRIBE_BASE_URL` | Server | Yes for live email | Canonical HTTPS app origin, no query/fragment |
| `GITHUB_TOKEN` | Server | If GitHub sourcing is used | Read-only token for source search |
| `TAVILY_API_KEY` | Server | If Tavily web sourcing is used | Server-side fallback; stored workspace key can take precedence |
| `KIMI_API_KEY` | Server | If Kimi provider is used | Kimi/Moonshot provider key |
| `KIMI_BASE_URL` | Server | Optional | Defaults to `https://api.moonshot.ai/v1` |
| `ELEVENLABS_API_KEY` | Server | If voice TTS is used | ElevenLabs API key |
| `ELEVENLABS_VOICE_ID` | Server | Optional with voice TTS | Defaults in code when unset |
| `WHATSAPP_TOKEN` | Server | If WhatsApp used | Meta Cloud API token |
| `WHATSAPP_PHONE_NUMBER_ID` | Server | If WhatsApp used | Meta registered sender ID |
| `WHATSAPP_API_VERSION` | Server | Optional with WhatsApp | Defaults to `v21.0` |
| `WHATSAPP_VERIFY_TOKEN` / `WHATSAPP_APP_SECRET` | Server | If WhatsApp webhooks used | Verify Meta subscription and signatures |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` | Server | Reserved | SMS remains disabled until equivalent controls exist |
| `FLOWISE_URL` / `FLOWISE_API_KEY` | Server | If Flowise inference used | Private runtime only; browser authoring remains disabled |
| `OBSCURA_URL` / `OBSCURA_BIN_PATH` | Server | Optional research sidecar | Read-only browser research sidecar endpoint or binary path |

Verify all variables are visible in Vercel before continuing:

```bash
vercel env ls --environment production
```

---

## 4. Deploy to Vercel

### Option A — Git push (recommended for main deployments)

```bash
git push origin main
```

Vercel's GitHub integration triggers a build automatically. Monitor in the Vercel dashboard.

### Option B — Vercel CLI (manual or hotfix)

```bash
vercel --prod
```

The CLI will print the deployment URL on completion.

### Build output to expect

```
Route (app)                              Size
┌ ○ /                                    ...
├ ○ /login                               ...
├ ○ /floor                               ...
...
✓ Build completed
```

Any `Error` or `Type error` output is a hard stop — rollback or fix before proceeding.

---

## 5. Post-deployment smoke check

Run these manually within 10 minutes of a production deploy. If any step fails, trigger the rollback runbook.

### 5a. Auth flow

1. Open `https://<app>/login` in an incognito window.
2. Click **Continue with Microsoft**.
3. Complete Entra SSO.
4. Confirm redirect to `/` or `/floor` (not an error page).
5. Check browser console — 0 errors expected.

### 5b. Critical routes

| Route | Expected | Pass? |
|---|---|---|
| `/` | Redirects to `/login` (if not authed) or dashboard | |
| `/floor` | Operations floor renders (2D grid + 3D toggle) | |
| `/fleet` | Fleet page loads, agent list visible | |
| `/settings` | Settings tabs render (requires admin role) | |
| `/chat` | Chat interface loads | |
| `/outreach` | Outreach panel loads | |

### 5c. Server-side key vault

```bash
# POST a test key (admin user's session cookie required):
curl -s -X POST https://<app>/api/keys \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie>" \
  -d '{"name":"smoke-test","provider":"test","value":"sk-test-1234567890"}'
# Expect: {"ok":true, "last4":"7890", ...}
# The 'secret' field must NOT appear in the response.
```

### 5d. Outreach dry-run guard

Navigate to `/outreach`, create a draft outreach. Confirm that:
- The human approval gate is visible before any send.
- No outreach is dispatched without explicit confirmation.
- If any seat is in dry-run mode, "Dry run" is displayed — no real email is sent.

### 5e. CSP headers

```bash
curl -sI https://<app>/ | grep -i content-security-policy
# Must return a non-empty CSP header with at least: default-src, script-src, connect-src
```

### 5f. Email unsubscribe proof (before enabling any live email seat)

1. Send one approved email to a controlled inbox.
2. Inspect raw MIME: it must contain `List-Unsubscribe`,
   `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, and a visible footer link.
3. Open the link: GET must show the confirmation page without changing suppression.
4. Submit the form/one-click POST and verify one permanent `suppression_list` email row.
5. Attempt another approved send to that address: it must return `skipped` before a provider call.

### 5g. WhatsApp delivery proof (only if enabled)

1. Configure Meta's webhook to `/api/webhooks/whatsapp` and verify the challenge.
2. Send a controlled approved template or in-window reply.
3. Confirm `messages_outbound.provider_message_id` is populated only after Meta accepts it.
4. Confirm `whatsapp_delivery_events` records the signed `sent`/`delivered`/`read` receipt.

### 5h. Hermes proxy (if HERMES_API_URL is set)

```bash
curl -s -X POST https://<app>/api/hermes/chat \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie>" \
  -d '{"messages":[{"role":"user","content":"ping"}]}'
# Expect: streaming JSON or {"role":"assistant","content":"..."}
# Must NOT return a 401 or 500 on a valid session.
```

---

## 6. Notify team

Post in the team channel once smoke checks pass:

```
[DEPLOY] Hermes Sourcing deployed to production
Commit: <short SHA>
Deploy URL: https://<app>/
Smoke checks: PASS
Deployed by: <name>
Time: <UTC timestamp>
```

---

## Deployment checklist (quick reference)

- [ ] `npm run typecheck` → exit 0
- [ ] `npm run lint` → no errors
- [ ] `npm run test` → 0 failures
- [ ] `npm run build` (CI or unsynced checkout) or `npm run build:isolated` (OneDrive checkout) → no errors
- [ ] DB migrations applied and RLS confirmed
- [ ] All required env vars set in Vercel
- [ ] `git push origin main` or `vercel --prod`
- [ ] Auth flow smoke check passed
- [ ] Critical routes all load
- [ ] CSP header present
- [ ] No console errors on `/floor`, `/fleet`, `/settings`
- [ ] Outreach approval gate visible
- [ ] Team notified
