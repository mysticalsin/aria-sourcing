---
project: MSourcing / ARIA
shift: 383
agent: cursor-cloud
updated: 2026-08-29T14:55Z
status: e2e-partial-awaiting-real-graph-secrets
---

# Handoff — Shift 383

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** OPEN
- **Live Fly:** **`fe01737`** / **0074** · tip docs-ahead · loop primary **2863e10bd41e28**
- **PARTIAL E2E:** last **58/0/2** on `fe01737` — step 3c PASS · classifier=model
- **Graph:** still owner-blocked · allowedToCreateApps=false · ownedObjects=[] · no dropzone
- **New:** waiters auto-discover owned `ARIA Mantu Graph*` apps via Graph ownedObjects (no dropzone file required once Owners Add Tony)
- **Gate:** audit **66/66**

## Done this shift

1. Re-probed Entra — still noperm; zero ARIA Mantu Graph apps; Tony owns nothing
2. ClickUp search for Graph/Entra — empty
3. `owner_ms_discover_owned_aria_app_id` + materialize into `/tmp/owner-azure-app-id` wired into watch / fly-wait / probe

## Blockers

- Entra admin → Register **ARIA Mantu Graph (Fly)** + **Owners Add twalteur@amaris.com** (+ Grant admin consent)  
  → waiters auto-discover OR `echo '<id>' > /tmp/owner-azure-app-id` → apply → Connect Outlook → `verify-m365-ready` → **RESULT: PASS**

## Next steps

```bash
bash scripts/print-m365-owner-portal-checklist.sh
# After Owners Add Tony (dropzone optional):
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
```

## Decisions made (don't relitigate)

- Production = Fly only; PR #36 only; Entra admin must register + Owners Add Tony
- Waiters auto-discover owned ARIA Mantu Graph apps (ownedObjects)

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show” + `print-fly-deploy-confirm`
- Never invent Microsoft secrets; reject synthetic app ids
