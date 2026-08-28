---
project: MSourcing / ARIA
shift: 272
agent: cursor-cloud
updated: 2026-08-28T10:43Z
status: timer-reprobe-still-blocked-7-secrets
---

# Handoff — Shift 272

## Current state

- **Live Fly:** `344fcaf` / **0071** · ready ok
- **Branch tip:** `e49d3df` (apply→post-m365 one-shot)
- **PR #35** (supersedes closed #29–#33)
- **Timer m365-secrets-reprobe:** all **7 secrets still missing** · no `/tmp/owner-microsoft.env` · noperm latch
- **Watcher:** tmux `watch-owner-microsoft` active
- **Setup actions re-requested** (Entra portal + 7 secrets)

## Done this shift

1. Timer reprobe — unchanged; strict E2E / verify-m365 not runnable

## Blockers

1. Owner Entra app in Mantu Sandbox `ce57ebe3…` + 7 Fly secrets

## Next steps

1. Owner: `bash scripts/print-m365-owner-portal-checklist.sh` → fill `/tmp/owner-microsoft.env` → `bash scripts/fly-apply-owner-microsoft-secrets.sh`
2. Connect Outlook (live) → Enable Graph webhook
3. `bash scripts/verify-m365-ready.sh` → strict PASS incl. **6b**
4. `env -u ARIA_ALLOW_PARTIAL_M365_E2E bash e2e-workflow-test.sh`

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
