# M365 owner unblock — Fly production

**Blocker ID:** M365-FLY-6  
**Production:** https://aria-mantu-app.fly.dev only  
**Updated:** 2026-08-28

## Missing Fly secrets (6)

| App | Secret |
|---|---|
| aria-mantu-app | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` |
| aria-mantu-auth | `GOTRUE_EXTERNAL_AZURE_ENABLED`, `GOTRUE_EXTERNAL_AZURE_CLIENT_ID`, `GOTRUE_EXTERNAL_AZURE_SECRET`, `GOTRUE_EXTERNAL_AZURE_URL` |

## Why agent cannot self-serve

`twalteur@amaris.com` is az-logged-in but **Insufficient privileges** to create app registrations.  
`az-create-mantu-graph-app.sh` exits 3; marker: `/tmp/az-create-mantu-graph-app.noperm`

## Owner action (pick one)

### A — Portal app + configure script

```bash
bash scripts/print-m365-owner-portal-checklist.sh   # tenant-specific URLs
# After portal: copy Application (client) ID + client secret
export ARIA_AZURE_APP_ID='<client-id>'
bash scripts/az-configure-existing-graph-app.sh --apply
bash scripts/fly-deploy-now.sh   # after print-fly-deploy-confirm.sh
```

### B — Paste env drop-zone

```bash
cp production-readiness/.owner-microsoft.env.example /tmp/owner-microsoft.env
# edit real values
bash scripts/fly-apply-owner-microsoft-secrets.sh
bash scripts/fly-deploy-now.sh
```

## Full E2E gate (no partial flags)

Without M365 + with sourcing quota exhausted (2026-08-28):

- **Strict run:** 42 pass, **9 fail** → `RESULT: FAIL`
- Failures: Hermes live drafts (steps 4–5), confirmLive Teams (6b), sourcing/candidate chain (3c quota)
- **Honest partial** (`run-enterprise-e2e-partial.sh`): 38 pass, 0 fail, 4 warn

After M365 + quota reset, expect:

```bash
APP_URL=https://aria-mantu-app.fly.dev bash e2e-workflow-test.sh
# → RESULT: PASS (no ARIA_ALLOW_PARTIAL_* flags)
```

## Post-M365 UI steps

1. Settings → Connect Outlook (live seat, mode=live)
2. Enable Graph webhook subscription
3. Connect verified delivery domain (P-7) for live email send
