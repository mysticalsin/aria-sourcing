---
project: MSourcing / ARIA
shift: 362
agent: cursor-cloud
updated: 2026-08-29T11:57Z
status: e2e-partial-awaiting-real-graph-secrets
---

# Handoff — Shift 362

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft OPEN
- **Live Fly:** **`f532707`** / **0074** · tip docs-ahead (scripts only) · loop primary **2863e10bd41e28**
- **PARTIAL E2E:** **58/0/2** on `f532707` (prior) — clean approve path
- **Graph:** `graph_secrets_missing=3` · Entra create still Insufficient privileges
- **New:** `/tmp/owner-azure-app-id` → `probe-m365-unblock.sh --apply` configures + mints + applies

## Done this shift

1. Reconfirmed az cannot create apps; no aria-mantu redirect apps
2. `fly-m365-from-azure-app-id.sh` + probe detects azure-app-id dropzone
3. Checklist minimal path: owner creates empty app, drops client id only

## Blockers

- Owner: Azure Portal Register "ARIA Mantu Graph (Fly)" →  
  `echo '<client-id>' > /tmp/owner-azure-app-id` → agent `--apply`
- Then Connect Outlook → `verify-m365-ready` for RESULT: PASS

## Next steps

```bash
bash scripts/print-m365-owner-portal-checklist.sh
# Owner minimal:
#   echo '<app-client-id>' > /tmp/owner-azure-app-id
#   bash scripts/probe-m365-unblock.sh --apply
# expect RESULT: applied-ok-from-azure-app-id + microsoftOAuth=true
# Settings → Connect Outlook → webhook + Calendars + OnlineMeetings
# bash scripts/verify-m365-ready.sh
unset AGENT_PROVIDER AGENT_MODEL
bash scripts/run-enterprise-e2e-partial.sh
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
- Monotonous demo UUIDs are PLACEHOLDER
- Owner app-id dropzone is enough — agent configures + mints secret
- compensationNorms never in candidate-bound prompts; Aria · Mantu Group signature

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show” + `print-fly-deploy-confirm`
- `/tmp/owner-deploy-confirm.env` must be KEY=value only (two lines)
- Never print Microsoft secret values
- Reject synthetic app ids in /tmp/owner-azure-app-id
