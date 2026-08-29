---
project: MSourcing / ARIA
shift: 381
agent: cursor-cloud
updated: 2026-08-29T14:18Z
status: e2e-partial-awaiting-real-graph-secrets
---

# Handoff — Shift 381

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** OPEN (reopened after accidental close)
- **Live Fly:** **`f650f63`** / **0074** · `tip_live` · loop primary **2863e10bd41e28** started
- **PARTIAL E2E:** **58/0/2** on `f650f63` — Running: `ARIA_ALLOW_PARTIAL_M365_E2E=1` only · step 3c PASS · classifier=model · Hermes
- **Graph:** `graph_secrets_missing=3` · allowedToCreateApps=false · zero fly.dev apps · no dropzone
- **Settings (live):** Owners → Add twalteur@amaris.com in Graph OAuth empty-state
- **Gate:** tsc + npm test green · audit **66/66**

## Done this shift

1. Re-probed Entra — still Insufficient privileges / noperm
2. Settings + tests: Owners Add Tony required in Connect Outlook disabled hint
3. Reminted Fly to **`f650f63`**; PARTIAL re-verified 58/0/2
4. Reopened PR #36

## Blockers

- Entra admin → Register + **Owners Add Tony** + Grant admin consent →  
  `echo '<id>' > /tmp/owner-azure-app-id` → (if consent CLI failed: `touch /tmp/az-graph-admin-consent.portal-granted`) →  
  apply → Connect Outlook → `verify-m365-ready` → **RESULT: PASS**

## Next steps

```bash
bash scripts/print-m365-owner-portal-checklist.sh
echo '<application-client-id>' > /tmp/owner-azure-app-id
# touch /tmp/az-graph-admin-consent.portal-granted   # after Portal Grant if needed
bash scripts/probe-m365-unblock.sh --apply
# Settings → Connect Outlook (mode=live)
bash scripts/verify-m365-ready.sh   # RESULT: PASS
unset AGENT_PROVIDER AGENT_MODEL
bash scripts/run-enterprise-e2e-partial.sh
# expect step 3c PASS; RESULT: PARTIAL until live Graph seat
```

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
bash scripts/print-fly-deploy-confirm.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# step 3c should show PASS when running PARTIAL E2E
# Do NOT run verify-m365-ready until real Graph secrets + Connect Outlook.
```

## Decisions made (don't relitigate)

- Production = Fly only; ignore Vercel/GHA empty-steps; PR #36 only
- Entra admin must register **and add Tony as Owner**; Graph perms fail-closed
- After Portal Grant: portal-granted marker or ~60s TTL then SKIP consent CLI
- Shared configure+apply lock; release before seat wait

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show” + `print-fly-deploy-confirm`
- Never invent Microsoft secrets; reject synthetic app ids
- `/tmp/owner-deploy-confirm.env` must be KEY=value only (two lines)
