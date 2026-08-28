---
project: MSourcing / ARIA
shift: 259
agent: cursor-cloud
updated: 2026-08-28T09:05Z
status: tip-live-244132b-e2e-partial-m365-owner-blocked
---

# Handoff — Shift 259

## Current state

- **Branch / Live Fly tip:** `244132b` · migration **0071** · PR [#35](https://github.com/mysticalsin/aria-sourcing/pull/35)
- **Test gate / audit:** green; **59/59** (last verified prior shift)
- **Fly E2E (PARTIAL):** **48 pass, 0 fail, 1 warn** — only skip **6b** confirmLive Teams
- **M365 secrets still missing** (re-probed 2026-08-28T09:05Z):
  - aria-mantu-app: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`
  - aria-mantu-auth: all 4 `GOTRUE_EXTERNAL_AZURE_*`
- **Redirect URIs (authoritative):**
  - App: `https://aria-mantu-app.fly.dev/auth/microsoft/callback`
  - GoTrue: `https://aria-mantu-kong.fly.dev/auth/v1/callback`
- Post-secrets gate hardened: `bash scripts/verify-m365-ready.sh` now checks secrets → microsoftOAuth → live seat+webhook → strict E2E (no partial flags)

## Done this shift

1. Re-probed Fly secrets + az `--show-mine` (empty) + noperm marker still present
2. Hardened `scripts/verify-m365-ready.sh` (fail-closed preflight before strict E2E)
3. Updated `_relay/M365-OWNER-UNBLOCK.md` + portal checklist to `verify-m365-ready.sh` + correct Kong callback
4. Re-requested Cursor setup actions for 6 secrets + Entra app registration

## Blockers

1. **Owner M365-FLY-6** — Entra app + 6 Fly secrets (agent cannot create app regs)

## Next steps

1. Owner: `bash scripts/print-m365-owner-portal-checklist.sh` → portal app → `/tmp/owner-microsoft.env` → `bash scripts/fly-apply-owner-microsoft-secrets.sh` → tip deploy
2. Settings → Connect Outlook (mode=live) → Enable Graph webhook
3. `bash scripts/verify-m365-ready.sh` → RESULT: PASS (incl. 6b Teams joinUrl)
4. Loop kill switch only after full PASS

## Decisions made (don't relitigate)

- **Production = Fly only** — ignore Vercel/GitHub Actions CI
- Do not lower SOURCING_QUALITY_FLOOR or invent candidates
- GoTrue callback host is **Kong** (`aria-mantu-kong.fly.dev`), not aria-mantu-auth

## Watch out

- Timer `m365-secrets-reprobe` every 30m — on fire, re-probe secrets then run verify path
- Full `fly-deploy-now.sh` bootstrap may timeout; app-only deploy OK if migration 0071 already applied

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# expect build 244132b…, migration 0071
ARIA_ALLOW_PARTIAL_M365_E2E=1 bash e2e-workflow-test.sh
# → 48 pass PARTIAL until secrets; never pretends full PASS while 6b skipped
# After secrets + Connect Outlook:
bash scripts/verify-m365-ready.sh
```
