---
project: MSourcing / ARIA
shift: 363
agent: cursor-cloud
updated: 2026-08-29T12:00Z
status: e2e-partial-awaiting-real-graph-secrets
---

# Handoff — Shift 363

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft OPEN
- **Live Fly:** **`f532707`** / **0074** · tip docs-ahead · PARTIAL **58/0/2** (prior)
- **Graph:** `graph_secrets_missing=3` · create still Insufficient privileges
- **Waiter:** tmux `fly-wait-entra` polling `/tmp/owner-azure-app-id` + microsoft env (360m)

## Done this shift

1. Confirmed no dropzones; Entra create still blocked
2. Waiter watches `owner-azure-app-id`; M365-OWNER-UNBLOCK minimal path refreshed
3. Started background `fly-wait-entra-and-golive.sh`

## Blockers

- Owner: Register Entra app → `echo '<id>' > /tmp/owner-azure-app-id` (waiter auto-applies)
- Then Connect Outlook → `verify-m365-ready` for RESULT: PASS

## Next steps

```bash
# Owner:
echo '<application-client-id>' > /tmp/owner-azure-app-id
# Waiter or:
bash scripts/probe-m365-unblock.sh --apply
# Settings → Connect Outlook → webhook + Calendars + OnlineMeetings
bash scripts/verify-m365-ready.sh
unset AGENT_PROVIDER AGENT_MODEL
bash scripts/run-enterprise-e2e-partial.sh
# expect step 3c PASS; RESULT: PARTIAL until live Graph seat
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
- PR #36 only; Graph-minimum; monotonous UUIDs PLACEHOLDER
- Owner app-id dropzone enough for agent configure+mint+apply
- Waiter may auto-apply when dropzone appears

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show” + `print-fly-deploy-confirm`
- Never print Microsoft secrets; reject synthetic app ids
