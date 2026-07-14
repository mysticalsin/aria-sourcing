# Vercel go-live runbook — MSourcing LIVE (real tenant)

> Purpose: take the app from "code is ready" to "Tony pastes a need on a public URL and it gets worked."
> The app is deliberately fail-closed: production without a real Supabase backend refuses to run
> (it will NOT silently demo). So a cloud Supabase project is mandatory. Steps marked **[YOU]**
> need Tony (account/login/secret); everything else is scripted.

## What already works (proven this session)
- Sourcing pipeline is real: a pasted JD → GitHub + Tavily/LinkedIn discovery → real candidates (live-smoke verified).
- Encrypted key vault, candidate-disclosure security layer, exec dashboard, winlog, Databricks intake, Tavily MCP — all shipped, gate green (97 suites).

## The gap to a working LIVE deployment (ordered)

### 1. [YOU] Decide the Vercel target
The linked project (`.vercel/project.json`) is the PUBLIC DEMO `aria-sourcing-demo` and carries
`NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true` (open admin/admin, everything dry-run). For a real tenant, EITHER:
- (recommended) create a NEW Vercel project for LIVE, keeping the demo alive; OR
- repurpose this one and DELETE `NEXT_PUBLIC_ENABLE_DEMO_LOGIN` from its Production env.

### 2. [YOU] Create a cloud Supabase project
supabase.com → New project. Note the project ref, the anon key, the service-role key, and set a DB password.

### 3. Apply all migrations (scripted, one command after you log in)
```
supabase login            # [YOU] interactive, one time
supabase link --project-ref <ref>
supabase db push          # applies supabase/migrations/0001..0018 in order (0016 intentionally absent)
```
Verifies: RLS on every table, the RPCs (ensure_workspace, claim_email/whatsapp_outbound, record_outreach_approval, finalize_whatsapp_provider_failure), the 0018 first-admin grant.

### 4. Set the LIVE env in Vercel (scripted from staged values; you provide account login)
Required for LIVE (the app 503s / dry-runs without them):
| Var | Source | Purpose |
|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / SUPABASE_SERVICE_ROLE_KEY | step 2 | live persistence + RLS + server writes |
| DATA_ENCRYPTION_KEY | staged (`openssl rand -base64 32`) | encrypt vault secrets + OAuth tokens at rest |
| CRON_SECRET | staged (`openssl rand -hex 32`) | daily WhatsApp dispatch backstop |
| OUTREACH_UNSUBSCRIBE_BASE_URL | `https://<live-domain>` | email send refuses without it (CAN-SPAM) |
| TAVILY_API_KEY | provided by Tony | LinkedIn/web sourcing quality |
| GITHUB_TOKEN | optional | GitHub sourcing 5000/hr vs 60 |
| a delivery key: RESEND_API_KEY (or SENDGRID_API_KEY) OR GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI | **[YOU]** | actually send outreach (else dry-run) |
| ANTHROPIC_API_KEY (or a vault LLM key) | optional | one-shot agentic "it gets worked" loop; deterministic drafts work without it |

Do NOT set `NEXT_PUBLIC_ENABLE_DEMO_LOGIN` on the LIVE project.

### 5. [YOU] First login → you're admin automatically (migration 0018)
Sign in via the login page (Supabase email/password: create your user in Supabase → Authentication → Users,
auto-confirm; OR configure Azure/Entra SSO). The first profile in a new workspace is granted admin by 0018 —
no manual SQL.

### 6. [YOU, ~5 min] Sending domain (only if you want real email delivery in the acceptance test)
Publish SPF + DMARC for the sending domain and verify it in Resend/SendGrid, OR connect a Gmail/Microsoft
mailbox seat via OAuth (needs the Google/MS env from step 4). Without this, sends degrade to dry-run.

### 7. Deploy + acceptance
```
vercel --prod             # or let the git push auto-deploy on the LIVE project
```
Acceptance (the "put a need in, it gets worked" test), on the LIVE URL:
1. Paste a real hiring need in intake → campaign created.
2. Source → real candidates appear (GitHub/LinkedIn), provenance=live.
3. Draft outreach → approve → send (real, if step 6 done; else the pipeline still proves through approval).
4. (with a connected mailbox) reply → book → winlog entry + exec dashboard updates.

## Minimum to demo REAL sourcing fast (skip outreach delivery)
Steps 1-5 + TAVILY_API_KEY + GITHUB_TOKEN. That gives paste-need → real candidates on a public URL.
Full send/reply/book acceptance additionally needs step 6.
