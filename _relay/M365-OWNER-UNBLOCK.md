# M365 owner unblock — Fly production

**Blocker ID:** M365-FLY-6  
**Production:** https://aria-mantu-app.fly.dev only  
**Updated:** 2026-08-28T09:45Z

## Missing Fly secrets (6)

| App | Secret |
|---|---|
| aria-mantu-app | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` (`MICROSOFT_REDIRECT_URI` + `DATA_ENCRYPTION_KEY` already set) |
| aria-mantu-auth | `GOTRUE_EXTERNAL_AZURE_ENABLED`, `GOTRUE_EXTERNAL_AZURE_CLIENT_ID`, `GOTRUE_EXTERNAL_AZURE_SECRET`, `GOTRUE_EXTERNAL_AZURE_URL` |

## Why agent cannot self-serve

`twalteur@amaris.com` is az-logged-in but:

- **Insufficient privileges** to create app registrations (`Authorization_RequestDenied`)
- **Owns zero apps** (`az ad app list --show-mine` empty)

Marker: `/tmp/az-create-mantu-graph-app.noperm`

## Current E2E evidence (2026-08-28)

```bash
ARIA_ALLOW_PARTIAL_M365_E2E=1 bash e2e-workflow-test.sh
# → core green; step 3c PASS top-10 shortlist (10 live, totalFound=10)
```

- Webhook need + **top-10 live sourcing** + calendar dry-run PASS
- **Only remaining skip:** step **6b** confirmLive Teams book (no Graph seat — secrets missing)
- Live tip: `81a2445` · migration **0071**

## Owner action (pick one)

### A — Portal app + configure script

```bash
bash scripts/print-m365-owner-portal-checklist.sh   # tenant-specific URLs
# After portal: copy Application (client) ID + client secret
export ARIA_AZURE_APP_ID='<client-id>'
bash scripts/az-configure-existing-graph-app.sh --apply
bash scripts/fly-apply-owner-microsoft-secrets.sh --yes
# remint confirm, then:
bash scripts/fly-deploy-now.sh
```

### B — Paste env drop-zone

```bash
cp production-readiness/.owner-microsoft.env.example /tmp/owner-microsoft.env
# edit real values
bash scripts/fly-apply-owner-microsoft-secrets.sh --yes
bash scripts/fly-deploy-now.sh
```

### C — Tenant admin grants Application.ReadWrite.OwnedBy

Then agent can run `az ad app create` via `scripts/az-create-mantu-graph-app.sh`.

## Full E2E gate (no partial flags)

After M365 secrets + Connect Outlook (mode=live) + Graph webhook:

```bash
APP_URL=https://aria-mantu-app.fly.dev bash e2e-workflow-test.sh
# → RESULT: PASS (no ARIA_ALLOW_PARTIAL_* flags)
```

## Post-M365 UI steps

1. Settings → Connect Outlook (live seat, mode=live)
2. Enable Graph webhook subscription
3. Connect verified delivery domain (P-7) for live email send
4. Confirm Entra SSO on `/login` after GoTrue Azure secrets + `NEXT_PUBLIC_ENABLE_AZURE_LOGIN=true`
