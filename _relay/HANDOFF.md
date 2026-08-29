---
project: MSourcing / ARIA
shift: 385
agent: cursor-cloud
updated: 2026-08-29T15:20Z
status: e2e-partial-awaiting-real-graph-secrets
---

# Handoff — Shift 385

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** OPEN
- **Live Fly:** **`1665b39`** / **0074** · `tip_live` · loop primary **2863e10bd41e28**
- **PARTIAL E2E:** see `/tmp/e2e-partial-1665b39.log` — expect step 3c PASS · `ARIA_ALLOW_PARTIAL_M365_E2E=1` only
- **Graph:** still owner-blocked · both tenants `allowedToCreateApps=false`
- **Non-M365 PASS path:** audit says nothing material beyond Graph seat
- **Gate:** audit **66/66**

## Done this shift

1. Confirmed create-for-rbac / BAW also noperm
2. `encryptionReady` requires valid 32-byte base64 key (not junk)
3. Reminted live **`1665b39`**

## Blockers

- Entra admin → Register + Owners Add Tony + Grant → waiters apply → Connect Outlook → `verify-m365-ready` → **RESULT: PASS**

## Next steps

```bash
bash scripts/print-m365-owner-portal-checklist.sh
bash scripts/probe-m365-unblock.sh --apply   # after Owners Add / dropzone
bash scripts/verify-m365-ready.sh            # RESULT: PASS
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
```

## Decisions made (don't relitigate)

- Production = Fly only; PR #36 only; Entra admin + Owners Add Tony required
- encryptionReady must match crypto-secrets valid key

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show” + `print-fly-deploy-confirm`
- Never invent Microsoft secrets
