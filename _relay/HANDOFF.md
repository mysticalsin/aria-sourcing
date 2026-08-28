---
project: MSourcing / ARIA
shift: 260
agent: cursor-cloud
updated: 2026-08-28T09:21Z
status: tip-ahead-tenant-oauth-fix-m365-owner-blocked
---

# Handoff — Shift 260

## Current state

- **Live Fly tip:** `244132b` · migration **0071** · `deploy_status=stale_owner_remint_required` (branch tip ahead with Graph tenant OAuth fix — remint after secrets)
- **PR:** [#35](https://github.com/mysticalsin/aria-sourcing/pull/35) (supersedes closed #29–#33)
- **Test gate / audit:** green after this shift (expect **59/59**)
- **Fly E2E (PARTIAL):** **48 pass, 0 fail, 1 warn** on live tip — expect step **3c PASS**; only skip **6b** confirmLive Teams
- **M365 secrets still missing** (re-probed):
  - aria-mantu-app: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`
  - aria-mantu-auth: all 4 `GOTRUE_EXTERNAL_AZURE_*`
- **Redirect / authority (authoritative):**
  - App callback: `https://aria-mantu-app.fly.dev/auth/microsoft/callback`
  - GoTrue: `https://aria-mantu-kong.fly.dev/auth/v1/callback`
  - Graph OAuth: `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/*` (**never `/common/`** — AADSTS50194 on single-tenant)

## Done this shift

1. Fixed Graph OAuth authority to tenant-scoped (authorize/callback/refresh) + `MICROSOFT_TENANT_ID` apply path
2. Graph `ensure` probes Graph before trusting DB `unchanged`
3. Portal checklist: **Delegated** scopes first; noperm-aware watchers
4. Hardened `verify-m365-ready.sh` (incl. `MICROSOFT_TENANT_ID`)

## Blockers

1. **Owner M365-FLY-6** — Entra app + Fly secrets (agent Insufficient privileges / noperm)

## Next steps

1. Owner: `bash scripts/print-m365-owner-portal-checklist.sh` → `/tmp/owner-microsoft.env` → `bash scripts/fly-apply-owner-microsoft-secrets.sh`
2. Remint tip: `bash scripts/print-fly-deploy-confirm.sh` → `ARIA_PROD_DEPLOY_CONFIRM` → `bash scripts/fly-deploy-now.sh` (or app-only if 0071 already live)
3. Settings → Connect Outlook (mode=live) → Enable Graph webhook
4. `bash scripts/verify-m365-ready.sh` → RESULT: PASS (incl. 6b Teams joinUrl)
5. Loop kill switch only after full PASS

## Decisions made (don't relitigate)

- **Production = Fly only** — ignore Vercel/GitHub Actions CI
- Do not lower SOURCING_QUALITY_FLOOR or invent candidates
- GoTrue callback host is **Kong**; Graph OAuth uses **tenant** authority not `/common/`

## Watch out

- Tip remint required for tenant OAuth fix before Connect Outlook works on Fly
- Timer `m365-secrets-reprobe` — on fire, re-probe then verify path

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
bash scripts/print-fly-deploy-confirm.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# live still 244132b until remint; migration 0071
ARIA_ALLOW_PARTIAL_M365_E2E=1 bash e2e-workflow-test.sh
# → 48 pass, 0 fail, 1 warn; expect step 3c PASS; multi-agent critics PASS
# never pretends full PASS while 6b skipped
# After secrets + Connect Outlook:
bash scripts/verify-m365-ready.sh
```
