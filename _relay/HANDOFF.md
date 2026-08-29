---
project: MSourcing / ARIA
shift: 380
agent: cursor-cloud
updated: 2026-08-29T14:05Z
status: e2e-partial-awaiting-real-graph-secrets
---

# Handoff — Shift 380

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft OPEN
- **Live Fly:** **`8b1cd04`** / **0074** · tip docs-ahead (this shift = tip_ahead_docs) · loop primary **2863e10bd41e28**
- **PARTIAL E2E:** last verified **58/0/2** on `8b1cd04` — step 3c PASS · classifier=model · Hermes · `ARIA_ALLOW_PARTIAL_M365_E2E=1` only
- **Graph:** still `graph_secrets_missing=3` · allowedToCreateApps=false · no dropzone
- **Unblock path hardened:** Owner required on Entra app · admin-consent.needed waiter SKIP · shared configure+apply flock · apply releases lock before seat wait
- **Gate:** `npx tsc --noEmit && npm test` green · audit **66/66**

## Done this shift

1. Checklist + M365-OWNER-UNBLOCK: Entra admin **must add twalteur@amaris.com as Owner**
2. `az-configure`: owner list preflight before update/mint
3. Waiters + probe: `/tmp/az-graph-admin-consent.needed` → Portal Grant → `touch …portal-granted` (or ~60s TTL) → `ARIA_GRAPH_SKIP_ADMIN_CONSENT=1` retry
4. Shared lock `/tmp/aria-m365-configure-apply.lock`; `owner_ms_release_singleton_lock` before post-m365 seat wait
5. Audit matrix extended for Owner / consent / lock evidence

## Blockers

- Entra admin → Register + **Owners Add Tony** + Grant admin consent →  
  `echo '<id>' > /tmp/owner-azure-app-id` → (if consent CLI failed: `touch /tmp/az-graph-admin-consent.portal-granted`) →  
  apply → Connect Outlook → `verify-m365-ready` → **RESULT: PASS**

## Next steps

```bash
bash scripts/print-m365-owner-portal-checklist.sh
echo '<application-client-id>' > /tmp/owner-azure-app-id
# after Portal Grant if needed:
# touch /tmp/az-graph-admin-consent.portal-granted
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
- Shared configure+apply lock; release before seat wait; no tip_ahead_docs remint

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show” + `print-fly-deploy-confirm`
- Never invent Microsoft secrets; reject synthetic app ids
- Do not mention `flyctl secrets set` in non-allowlisted scripts (infra-release-contract)
