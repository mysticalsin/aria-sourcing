# M365 owner unblock — Fly production

**Blocker ID:** M365-FLY-6  
**Production:** https://aria-mantu-app.fly.dev only  
**Updated:** 2026-08-29T09:20Z

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

Entra reprobe 2026-08-28: **zero** apps with `aria-mantu` or `*.fly.dev` redirect URIs. Owner must create the app (agent can read apps but cannot create/update).

`GOTRUE_EXTERNAL_AZURE_URL=https://login.microsoftonline.com/ce57ebe3-a63d-4708-b5cf-c274b48bd26c/v2.0`

## Why agent cannot self-serve

`twalteur@amaris.com` is az-logged-in but Insufficient privileges / owns zero apps.  
Marker: `/tmp/az-create-mantu-graph-app.noperm`

## Current E2E evidence (2026-08-29)

```bash
bash scripts/run-enterprise-e2e-partial.sh
# → PARTIAL · 58 pass / 0 fail / 2 warn (Microsoft only) on live e5c37c1 / 0074
# classifier=model PASS; Hermes/vault LLM OK despite llm_auth=dead
```

Strict E2E (no partial flag) correctly **FAIL**s on: `microsoftOAuth=false` + step 6b (no Graph seat).

## Owner action

```bash
bash scripts/print-m365-owner-portal-checklist.sh
bash scripts/probe-m365-unblock.sh              # status (Graph bucket)
bash scripts/probe-m365-unblock.sh --apply      # when drop-zone or env exports ready
# Option A — existing app:
export ARIA_AZURE_APP_ID='<client-id>'
bash scripts/az-configure-existing-graph-app.sh --apply
# Option B — paste drop-zone (Graph-minimum; Entra lines optional):
cp production-readiness/.owner-microsoft.env.example /tmp/owner-microsoft.env
# edit real MICROSOFT_CLIENT_ID/SECRET/TENANT_ID (Entra PLACEHOLDER OK for Graph PASS)
bash scripts/fly-apply-owner-microsoft-secrets.sh   # auto-runs post-m365-secrets-golive
```

Then Settings → Connect Outlook (grant **Calendars.ReadWrite** + **OnlineMeetings.ReadWrite**, mode=live) → Enable Graph webhook → `bash scripts/verify-m365-ready.sh`  
Verifier: Graph secrets · microsoftOAuth · live seat (webhook + Calendars + OnlineMeetings) · Entra/LLM WARN-only · strict E2E (incl. **6b** Teams)
