---
project: MSourcing / ARIA
shift: 275
agent: cursor-cloud
updated: 2026-08-28T10:54Z
status: audit-60-60-m365-blocked
---

# Handoff — Shift 275

## Current state

- **Live Fly:** `344fcaf` / **0071** · ready ok
- **Branch tip:** post audit verify-m365 requirement
- **PR #35** (supersedes closed #29–#33)
- **Gate:** audit **60/60** · tsc green
- **M365:** 7 secrets missing · watcher active

## Done this shift

1. Audit matrix +60: verify-m365 strict gate (secrets, Graph seat, Entra /login, strict E2E)
2. Updated `_relay/M365-OWNER-UNBLOCK.md` owner runbook

## Blockers

1. Owner Entra app + 7 Fly secrets

## Next steps

1. `bash scripts/print-m365-owner-portal-checklist.sh` → apply → Connect Outlook → webhook
2. `bash scripts/verify-m365-ready.sh` → strict PASS incl. **6b**

## Decisions made (don't relitigate)

- **Production = Fly only** — never pretends full enterprise PASS while 6b skipped
- `bash scripts/print-fly-golive-status.sh` · `bash scripts/print-fly-deploy-confirm.sh`

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
ARIA_ALLOW_PARTIAL_M365_E2E=1 bash e2e-workflow-test.sh
# step 3c should show PASS; MS-gap PARTIAL only when FAILS=0
bash scripts/verify-m365-ready.sh
```
