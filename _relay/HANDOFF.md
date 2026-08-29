---
project: MSourcing / ARIA
shift: 384
agent: cursor-cloud
updated: 2026-08-29T15:05Z
status: e2e-partial-awaiting-real-graph-secrets
---

# Handoff — Shift 384

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** OPEN
- **Live Fly:** **`fe01737`** / **0074** · tip docs-ahead (`98af9e5`) · loop primary **2863e10bd41e28**
- **PARTIAL E2E:** last **58/0/2** on `fe01737` — step 3c PASS · classifier=model · Hermes
- **Graph:** `graph_secrets_missing=3` · allowedToCreateApps=false · ownedObjects apps=[] · no dropzone
- **Create probes:** `az ad app create` AND `az ad sp create-for-rbac` both Insufficient privileges
- **Waiters:** mkdir locks · owned-app discover (120s TTL) · watch + fly-wait running
- **Gate:** audit **66/66** · ignore Vercel rate-limit / GHA empty-steps

## Done this shift

1. Owned-app auto-discover + throttle + jq harden
2. mkdir locks (replace stranded flock FD)
3. Re-probed create-for-rbac — same noperm
4. Dedupe waiters

## Blockers

- **Only remaining PASS blocker:** Entra admin Register `ARIA Mantu Graph (Fly)` + **Owners Add twalteur@amaris.com** + Grant admin consent  
  → waiters auto-discover / dropzone → apply → Connect Outlook → `verify-m365-ready` → **RESULT: PASS**

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
# Do NOT run verify-m365-ready until real Graph secrets + Connect Outlook.
```

## Decisions made (don't relitigate)

- Production = Fly only; PR #36 only; ignore Vercel/GHA phantoms
- Entra admin must register + Owners Add Tony; waiters auto-discover owned ARIA apps
- mkdir locks for waiters; shared configure+apply lock; release before seat wait
- create-for-rbac is not an escape hatch under allowedToCreateApps=false

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show” + `print-fly-deploy-confirm`
- Never invent Microsoft secrets; reject synthetic app ids
- Do not `pkill -f` waiter script names from a shell whose cmdline embeds those strings
