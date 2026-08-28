---
project: MSourcing / ARIA
shift: 287
agent: cursor-cloud
updated: 2026-08-28T12:35Z
status: owner-wait-m365-strict-pass
---

# Handoff — Shift 287

## Current state

- **Live Fly:** `344fcaf` / **0071** · ready ok (tip `4e0c35d` not deployed — `deploy_status=stale_owner_remint_required`)
- **Branch tip:** pending commit (e2e hardening)
- **PR #35** (supersedes closed #29–#33)
- **Gate:** audit **62/62** · `npx tsc --noEmit` green
- **PARTIAL E2E (live, 2026-08-28T12:35Z):** **55 pass / 0 fail / 7 warn** → `RESULT: PARTIAL`
  - Multilingual LinkedIn/Email/WhatsApp FR drafts PASS
  - Approve `critics_required` → warn under partial flag
  - Sourcing empty → warn + outreach-only continuation
- **Strict E2E:** blocked — 7 M365 secrets + owner deploy confirm

## Done this shift

1. E2E hardening: approve 180s timeout + dedicated resp; sourcing retry; PARTIAL escapes for empty sourcing + critics_required
2. Re-probed M365 — still owner-blocked; setup actions re-requested (secrets + deploy confirm)
3. Golive status: `m365_secrets_missing=7`, Graph validationToken HTTP 200

## Blockers (owner only)

1. Entra app + **7 Fly secrets** — `_relay/M365-OWNER-UNBLOCK.md`
2. **Deploy confirm** for tip: `bash scripts/print-fly-deploy-confirm.sh` → export `ARIA_PROD_DEPLOY_CONFIRM` → `bash scripts/fly-enterprise-golive-when-ready.sh`
3. Settings → Connect Outlook (live) → Enable Graph webhook

## Next steps (owner)

```bash
bash scripts/print-fly-golive-status.sh
bash scripts/print-fly-deploy-confirm.sh
bash scripts/print-m365-owner-portal-checklist.sh
bash scripts/probe-m365-unblock.sh --apply
bash scripts/verify-m365-ready.sh
env -u ARIA_ALLOW_PARTIAL_M365_E2E bash e2e-workflow-test.sh
```

## Decisions made (don't relitigate)

- Production = Fly only; ignore Vercel/GHA CI
- Never claim full enterprise PASS while 6b skipped or partial flag set
- PARTIAL E2E may warn (not fail) on transient empty sourcing + approve critics_required when `ARIA_ALLOW_PARTIAL_M365_E2E=1`
- Outreach language: candidate languages → need locale → need language → seat → default

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
ARIA_ALLOW_PARTIAL_M365_E2E=1 bash e2e-workflow-test.sh
# step 3c should show PASS; MS-gap PARTIAL only when FAILS=0
bash scripts/verify-m365-ready.sh
bash scripts/print-fly-deploy-confirm.sh
```

## Watch out

- Strict E2E requires `microsoftOAuth=true` + step 6b live Teams joinUrl — no partial flag
- Live approve critics may 503 when LLM keys saturated — strict runs must not use partial escapes
