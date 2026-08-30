---
project: MSourcing / ARIA
shift: 263
agent: cursor-cloud
updated: 2026-08-28T09:55Z
status: tip-live-2abdef2-mantu-tenant-identified-m365-blocked
---

# Handoff — Shift 263

## Current state

- **Live Fly tip:** `2abdef2` · migration **0071** · tenant OAuth + OnlineMeetings live
- **PR:** [#35](https://github.com/mysticalsin/aria-sourcing/pull/35) (supersedes closed #29–#33)
- **Canonical Entra tenant:** `ce57ebe3-a63d-4708-b5cf-c274b48bd26c` (Mantu Group Sandbox) — not BAW SAS
- Agent scanned **1339** apps in Mantu Sandbox: **zero** with `aria-mantu-*.fly.dev` redirects; create still Insufficient privileges
- **M365 secrets still missing (7)**
- **PARTIAL E2E:** 48 pass / 0 fail / 1 warn (only **6b**); expect step **3c PASS**

## Done this shift

1. Identified correct Mantu Sandbox tenant; switched az default there
2. Tenant-wide app scan proved no existing Fly Graph app
3. Updated portal checklist + owner unblock with tenant-scoped portal URL + fixed Azure URL

## Blockers

1. **Owner** must create Entra app in Mantu Sandbox (or grant Application.ReadWrite.OwnedBy)

## Next steps

1. Owner: `bash scripts/print-m365-owner-portal-checklist.sh` → create app → apply → Connect Outlook → `verify-m365-ready.sh`
2. Loop kill switch only after full PASS

## Decisions made (don't relitigate)

- **Production = Fly only**
- Entra tenant for Fly Mantu = **ce57ebe3…** (Mantu Group Sandbox)
- Graph OAuth tenant authority + OnlineMeetings.ReadWrite

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
bash scripts/print-fly-deploy-confirm.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# expect build 2abdef2…, migration 0071
ARIA_ALLOW_PARTIAL_M365_E2E=1 bash e2e-workflow-test.sh
# expect step 3c PASS; never pretends full PASS while 6b skipped
bash scripts/post-m365-secrets-golive.sh
bash scripts/verify-m365-ready.sh
```
