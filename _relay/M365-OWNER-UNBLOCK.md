# M365 owner unblock — Fly production

**Blocker ID:** M365-FLY-6  
**Production:** https://aria-mantu-app.fly.dev only  
**Updated:** 2026-08-29T12:00Z

## Graph secrets required for E2E PASS (Graph-minimum)

| App | Secret |
|---|---|
| aria-mantu-app | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` (`MICROSOFT_REDIRECT_URI` + `DATA_ENCRYPTION_KEY` + `EMAIL_INBOUND_WEBHOOK_SECRET` usually already set) |

Entra GoTrue Azure (`GOTRUE_EXTERNAL_AZURE_*` on aria-mantu-auth) is **optional** for Graph/Outlook E2E PASS (SSO only). Fly-env LLM keys are also optional (Hermes/vault failover may already green drafts/critics).

Inventory: `bash scripts/print-fly-missing-secrets.sh` → `graph_secrets_missing=` (PASS blocker) vs `entra_secrets_missing=` / `llm_env_missing=` (WARN).

## Correct redirect URIs (do not invent)

| Purpose | URI |
|---|---|
| Graph OAuth (app) | `https://aria-mantu-app.fly.dev/auth/microsoft/callback` |
| GoTrue Entra (Kong) | `https://aria-mantu-kong.fly.dev/auth/v1/callback` |
| Azure URL | `https://login.microsoftonline.com/<tenant-id>/v2.0` |

**Canonical Entra tenant (Mantu Group Sandbox):** `ce57ebe3-a63d-4708-b5cf-c274b48bd26c`  
Do **not** use BAW SAS (`864aa37f-…`) for Fly Mantu Graph/SSO.

Entra scan: **zero** apps with `aria-mantu` or `*.fly.dev` redirect URIs. Owner must create the app (agent can read apps but cannot create). Reject PLACEHOLDER_* and monotonous demo UUIDs (`11111111-…`).

`GOTRUE_EXTERNAL_AZURE_URL=https://login.microsoftonline.com/ce57ebe3-a63d-4708-b5cf-c274b48bd26c/v2.0`

## Why agent cannot self-serve

`twalteur@amaris.com` is az-logged-in but Insufficient privileges / owns zero apps.  
Marker: `/tmp/az-create-mantu-graph-app.noperm`

## Current E2E evidence (2026-08-29)

```bash
bash scripts/run-enterprise-e2e-partial.sh
# → PARTIAL · 58 pass / 0 fail / 2 warn (Microsoft only) on live f532707 / 0074
# classifier=model PASS; clean approve (no disclosure-comp retries); Hermes/vault OK
```

Strict E2E (no partial flag) correctly **FAIL**s on: `microsoftOAuth=false` + step 6b (no Graph seat).

## Owner action (minimal — recommended)

```bash
bash scripts/print-m365-owner-portal-checklist.sh
# 1) Azure Portal → New registration: ARIA Mantu Graph (Fly), single-tenant
# 2) Copy Application (client) ID only:
echo '<application-client-id>' > /tmp/owner-azure-app-id
# 3) Agent finishes redirects + Graph perms + secret mint + Fly apply:
bash scripts/probe-m365-unblock.sh --apply
# expect RESULT: applied-ok-from-azure-app-id + microsoftOAuth=true
# 4) Settings → Connect Outlook → Enable webhook (Calendars + OnlineMeetings)
bash scripts/verify-m365-ready.sh   # RESULT: PASS
```

### Alternatives

```bash
# Full secrets drop-zone:
cp production-readiness/.owner-microsoft.env.example /tmp/owner-microsoft.env
# edit real MICROSOFT_CLIENT_ID/SECRET/TENANT_ID
bash scripts/probe-m365-unblock.sh --apply

# Or export ARIA_AZURE_APP_ID and configure existing app:
export ARIA_AZURE_APP_ID='<client-id>'
bash scripts/az-configure-existing-graph-app.sh --apply
# or:
bash scripts/fly-m365-from-azure-app-id.sh
```

Waiter (tmux-safe): `bash scripts/fly-wait-entra-and-golive.sh` also watches `/tmp/owner-azure-app-id`.
