---
project: MSourcing / ARIA
shift: 282
agent: cursor-cloud
updated: 2026-08-28T11:21Z
status: partial-e2e-green-m365-owner-blocked
---

# Handoff — Shift 282

## Current state

- **Live Fly:** `344fcaf` / **0071** · ready ok
- **Branch tip:** `ea0f0b4`
- **PR #35** (supersedes closed #29–#33)
- **Gate:** audit **60/60** · `npx tsc --noEmit && npm test` green (2026-08-28)
- **PARTIAL E2E (live):** 48 pass / 0 fail / 1 warn (6b only; 2026-08-28)
- **Strict E2E:** 49 pass / **2 fail** (microsoftOAuth + 6b)
- **M365:** 7 secrets missing · Entra zero aria-mantu apps · watcher active

## Done this shift

1. Added `probe-m365-unblock.sh` + shared credential helper; watcher requires full 7-var set
2. M365 reprobe — still owner-blocked (7 Fly secrets missing)

## Blockers

Owner Entra app + 7 Fly secrets — `_relay/M365-OWNER-UNBLOCK.md`

## Next steps

1. Owner: `/tmp/owner-microsoft.env` → `fly-apply-owner-microsoft-secrets.sh`
2. Connect Outlook → Enable webhook
3. `verify-m365-ready.sh` PASS incl 6b
4. `env -u ARIA_ALLOW_PARTIAL_M365_E2E bash e2e-workflow-test.sh` → PASS

## Decisions made (don't relitigate)

- Production = Fly only; ignore Vercel/GHA CI
- Never pretends full enterprise PASS while 6b skipped or partial flag set
- Tenant: `ce57ebe3-a63d-4708-b5cf-c274b48bd26c`
- `bash scripts/print-fly-golive-status.sh` · `bash scripts/print-fly-deploy-confirm.sh`

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
ARIA_ALLOW_PARTIAL_M365_E2E=1 bash e2e-workflow-test.sh
# step 3c should show PASS; MS-gap PARTIAL only when FAILS=0
bash scripts/verify-m365-ready.sh
```
