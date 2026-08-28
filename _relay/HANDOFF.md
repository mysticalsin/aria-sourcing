---
project: MSourcing / ARIA
shift: 278
agent: cursor-cloud
updated: 2026-08-28T11:10Z
status: partial-e2e-green-m365-owner-blocked
---

# Handoff — Shift 278

## Current state

- **Live Fly:** `344fcaf` / **0071** · ready ok
- **Branch tip:** `fb5c95f`
- **PR #35** (supersedes #29–#33)
- **Gate:** audit **60/60** · tsc + tests green
- **PARTIAL E2E:** 49 pass / 0 fail / 2 warn (`ARIA_ALLOW_PARTIAL_M365_E2E=1`)
- **Strict E2E:** 49 pass / **2 fail** (microsoftOAuth + 6b) — expected until M365
- **M365:** 7 secrets missing · Entra rescan zero fly.dev apps · watcher active

## Done this shift

1. Re-probed Entra — still zero apps with aria-mantu/fly.dev redirects
2. Confirmed az create still Insufficient privileges (noperm latch)
3. Confirmed strict E2E fails correctly (not PARTIAL) without M365
4. Re-requested owner setup action · timer `m365-secrets-reprobe` (30m)

## Blockers

Owner Entra app + 7 Fly secrets — see `_relay/M365-OWNER-UNBLOCK.md`

## Next steps

1. Owner: portal app + `/tmp/owner-microsoft.env` → `fly-apply-owner-microsoft-secrets.sh`
2. Connect Outlook → Enable webhook
3. `verify-m365-ready.sh` PASS incl 6b
4. `env -u ARIA_ALLOW_PARTIAL_M365_E2E bash e2e-workflow-test.sh` → PASS

## Decisions made (don't relitigate)

- Production = Fly only; ignore Vercel/GHA CI
- Never claim full PASS while 6b skipped or partial flag set
- Tenant: `ce57ebe3-a63d-4708-b5cf-c274b48bd26c`
