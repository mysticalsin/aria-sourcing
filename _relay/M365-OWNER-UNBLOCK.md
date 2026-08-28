# M365 owner unblock — Fly production

**Blocker ID:** M365-FLY-6  
**Production:** https://aria-mantu-app.fly.dev only  
**Updated:** 2026-08-28T09:15Z

## Missing Fly secrets (6)

| App | Secret |
|---|---|
| aria-mantu-app | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` (`MICROSOFT_REDIRECT_URI` + `DATA_ENCRYPTION_KEY` already set; tenant may be derived from `GOTRUE_EXTERNAL_AZURE_URL`) |
| aria-mantu-auth | `GOTRUE_EXTERNAL_AZURE_ENABLED`, `GOTRUE_EXTERNAL_AZURE_CLIENT_ID`, `GOTRUE_EXTERNAL_AZURE_SECRET`, `GOTRUE_EXTERNAL_AZURE_URL` |

## Correct redirect URIs (do not invent)

| Purpose | URI |
|---|---|
| Graph OAuth (app) | `https://aria-mantu-app.fly.dev/auth/microsoft/callback` |
| GoTrue Entra (Kong) | `https://aria-mantu-kong.fly.dev/auth/v1/callback` |
| Azure URL | `https://login.microsoftonline.com/<tenant-id>/v2.0` |

**Graph OAuth authority:** authorize/token use `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/*` — never `/common/` (single-tenant apps return AADSTS50194).

## Why agent cannot self-serve

`twalteur@amaris.com` is az-logged-in but:

- **Insufficient privileges** to create app registrations (`Authorization_RequestDenied`)
- **Owns zero apps** (`az ad app list --show-mine` empty)

Marker: `/tmp/az-create-mantu-graph-app.noperm`

## Current E2E evidence (2026-08-28)

```bash
ARIA_ALLOW_PARTIAL_M365_E2E=1 bash e2e-workflow-test.sh
# → 48 pass, 0 fail, 1 warn (PARTIAL)
```

- Webhook need → **top-10 live** → Hermes Mantu drafts → approve with **live multi-agent LLM critics (stages=6)** → LinkedIn 409 + email dry-run → calendar dry-run
- **Only remaining skip:** step **6b** confirmLive Teams book (no Graph seat — secrets missing)
- Live tip: `244132b` · migration **0071**

## Owner action (pick one)

### A — Portal app + configure script

```bash
bash scripts/print-m365-owner-portal-checklist.sh   # tenant-specific URLs
# After portal: copy Application (client) ID + client secret
export ARIA_AZURE_APP_ID='<client-id>'
bash scripts/az-configure-existing-graph-app.sh --apply
bash scripts/fly-apply-owner-microsoft-secrets.sh
# remint confirm, then:
bash scripts/fly-deploy-now.sh
```

### B — Paste env drop-zone

```bash
cp production-readiness/.owner-microsoft.env.example /tmp/owner-microsoft.env
# edit real values (redirect URIs above)
bash scripts/fly-apply-owner-microsoft-secrets.sh
bash scripts/fly-deploy-now.sh
```

### C — Tenant admin grants Application.ReadWrite.OwnedBy

Then agent can run `az ad app create` via `scripts/az-create-mantu-graph-app.sh`.

## Post-secrets UI + strict gate

1. Settings → Connect Outlook (`mode=live`)
2. Enable Graph webhook subscription (push intake — no polling)
3. Confirm Entra SSO on `/login` after GoTrue Azure secrets + tip deploy (`NEXT_PUBLIC_ENABLE_AZURE_LOGIN=true`)
4. Optional P-7: verified delivery domain for live email send

```bash
bash scripts/verify-m365-ready.sh
# fails closed if secrets / microsoftOAuth / live seat+webhook missing
# then runs e2e-workflow-test.sh with NO ARIA_ALLOW_PARTIAL_* → RESULT: PASS
```
