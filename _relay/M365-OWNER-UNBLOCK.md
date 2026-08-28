# M365 owner unblock — Fly production

**Blocker ID:** M365-FLY-6  
**Production:** https://aria-mantu-app.fly.dev only  
**Updated:** 2026-08-28T09:45Z

## Missing Fly secrets (7)

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

**Canonical Entra tenant (Mantu Group Sandbox):** `ce57ebe3-a63d-4708-b5cf-c274b48bd26c`  
Do **not** use BAW SAS (`864aa37f-…`) for Fly Mantu Graph/SSO.

Agent scanned 1339 apps in Mantu Sandbox — **zero** with `aria-mantu-*.fly.dev` redirects. Owner must create the app (agent can read apps but cannot create/update).

`GOTRUE_EXTERNAL_AZURE_URL=https://login.microsoftonline.com/ce57ebe3-a63d-4708-b5cf-c274b48bd26c/v2.0`

## Why agent cannot self-serve

`twalteur@amaris.com` is az-logged-in but Insufficient privileges / owns zero apps.  
Marker: `/tmp/az-create-mantu-graph-app.noperm`

## Current E2E evidence (2026-08-28)

```bash
ARIA_ALLOW_PARTIAL_M365_E2E=1 bash e2e-workflow-test.sh
# → 48 pass, 0 fail, 1 warn (PARTIAL) on tip 02b077b
```

Only remaining skip: step **6b** confirmLive Teams (no Graph seat).

## Owner action

```bash
bash scripts/print-m365-owner-portal-checklist.sh
# Option A — existing app:
export ARIA_AZURE_APP_ID='<client-id>'
bash scripts/az-configure-existing-graph-app.sh --apply
# Option B — paste drop-zone:
cp production-readiness/.owner-microsoft.env.example /tmp/owner-microsoft.env
# edit real values (incl MICROSOFT_TENANT_ID)
bash scripts/fly-apply-owner-microsoft-secrets.sh
# durable watcher auto-runs post-m365-secrets-golive; or:
bash scripts/post-m365-secrets-golive.sh
```

Then Settings → Connect Outlook → Enable webhook → `bash scripts/verify-m365-ready.sh` → RESULT: PASS
