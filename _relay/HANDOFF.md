---
project: MSourcing / ARIA
shift: 261
agent: cursor-cloud
updated: 2026-08-28T09:38Z
status: tip-live-02b077b-tenant-oauth-m365-owner-blocked
---

# Handoff — Shift 261

## Current state

- **Live Fly tip:** `02b077b` · migration **0071** · `deploy_status=tip_live`
- **PR:** [#35](https://github.com/mysticalsin/aria-sourcing/pull/35) (supersedes closed #29–#33)
- **Tenant OAuth fix is LIVE** — Graph authorize/token use `…/<tenant>/oauth2/v2.0/*` (not `/common/`)
- **M365 secrets still missing (7):**
  - aria-mantu-app: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`
  - aria-mantu-auth: all 4 `GOTRUE_EXTERNAL_AZURE_*`
- **Prior PARTIAL E2E (on 244132b):** 48 pass / 0 fail / 1 warn — expect step **3c PASS**; only skip **6b**
- Post-secrets: Connect Outlook → `bash scripts/verify-m365-ready.sh`

## Done this shift

1. Reminted tip `02b077b` live (app-only; migration already 0071) via `scripts/fly-remint-app-only.sh`
2. Tenant-scoped Graph OAuth + `MICROSOFT_TENANT_ID` apply path already on tip
3. Re-requested owner setup actions; durable microsoft watcher still polling drop-zone

## Blockers

1. **Owner M365-FLY-6** — Entra app + Fly secrets (noperm / Insufficient privileges)

## Next steps

1. Owner: portal checklist → `/tmp/owner-microsoft.env` (incl. `MICROSOFT_TENANT_ID`) → apply (watcher auto)
2. Settings → Connect Outlook (mode=live) → Enable Graph webhook
3. `bash scripts/verify-m365-ready.sh` → RESULT: PASS (6b Teams)
4. Loop kill switch only after full PASS

## Decisions made (don't relitigate)

- **Production = Fly only** — ignore Vercel/GitHub Actions CI
- Do not lower SOURCING_QUALITY_FLOOR or invent candidates
- Graph OAuth uses **tenant** authority not `/common/`
- App-only remint OK when live migration already tip-aligned

## Watch out

- `fly-remint-app-only.sh` may hit machine lease races; retry after lease expiry if needed
- Timer `m365-secrets-reprobe` every 30m

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
bash scripts/print-fly-deploy-confirm.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# expect build 02b077b…, migration 0071
ARIA_ALLOW_PARTIAL_M365_E2E=1 bash e2e-workflow-test.sh
# expect step 3c PASS; never pretends full PASS while 6b skipped
bash scripts/verify-m365-ready.sh   # after secrets + Connect Outlook
```
