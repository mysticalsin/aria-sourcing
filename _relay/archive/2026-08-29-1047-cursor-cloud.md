---
project: MSourcing / ARIA
shift: 356
agent: cursor-cloud
updated: 2026-08-29T10:35Z
status: e2e-partial-awaiting-real-graph-secrets
---

# Handoff — Shift 356

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft OPEN
- **Live Fly:** `29bd05b` / **0074** · `deploy_status=tip_live`
- **Gate/audit:** green · audit **65/65**
- **Graph secrets:** **ROLLED BACK (honest)** · `graph_secrets_missing=3` · `microsoftOAuth=false`
  - Prior apply used synthetic client_id `11111111-…` — authorize would fail at Microsoft
  - Fly Graph CLIENT/SECRET/TENANT unset; dropzone quarantined; probe `credentials=none`
- **LLM:** `llm_auth=dead` · Hermes/vault OK

## Done this shift

1. Detected false-ready Graph apply (synthetic UUID in authorize Location)
2. Unset fake Fly Graph secrets; quarantine dropzone
3. `microsoftCredentialLooksSynthetic` + bash placeholder reject monotonous demo UUIDs
4. Authorize + readiness fail-closed; tip_live `29bd05b` deployed

## Blockers

- Owner must supply **real** Entra app CLIENT_ID/SECRET/TENANT (not fixture UUIDs) in `/tmp/owner-microsoft.env`
- Then apply → Connect Outlook → `verify-m365-ready`

## Next steps

```bash
bash scripts/print-fly-golive-status.sh
# expect graph_secrets_missing=3 microsoftOAuth=false until REAL secrets
# Owner: real Azure app registration values only (reject 11111111-… / PLACEHOLDER_*)
#   cp production-readiness/.owner-microsoft.env.example /tmp/owner-microsoft.env
#   fill REAL MICROSOFT_CLIENT_ID/SECRET/TENANT_ID
#   bash scripts/probe-m365-unblock.sh --apply
#   Settings → Connect Outlook → Enable webhook
#   bash scripts/verify-m365-ready.sh
unset AGENT_PROVIDER AGENT_MODEL
bash scripts/run-enterprise-e2e-partial.sh
# expect Running: ARIA_ALLOW_PARTIAL_M365_E2E=1 only
# expect step 3c PASS; classifier=model PASS
# expect RESULT: PARTIAL until real Graph + live seat
```

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# step 3c should show PASS when running PARTIAL E2E
# Do NOT run verify-m365-ready until real Graph secrets + Connect Outlook.
```

## Decisions made (don't relitigate)

- Production = Fly only; ignore Vercel/GHA empty-steps
- PR #36 only
- Graph-minimum apply; Entra/LLM WARN-only
- **Monotonous demo UUIDs (11111111-…) are PLACEHOLDER** — never apply / never microsoftOAuth=true
- Deploy confirm remint is agent-owned (KEY=value only)
- Ban GitHub-activity boilerplate in draft signals

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show” + `print-fly-deploy-confirm`
- `/tmp/owner-deploy-confirm.env` must be KEY=value only (two lines)
- Never print Microsoft secret values; quarantine fake dropzones as `*.FAKE-QUARANTINED-*`
- After remint deploy, confirm loop primary started
