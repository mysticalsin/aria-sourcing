---
project: MSourcing / ARIA
shift: 288
agent: cursor-cloud
updated: 2026-08-28T13:06Z
status: owner-wait-m365-strict-pass
---

# Handoff — Shift 288

## Current state

- **Live Fly:** `1b19a44` / **0071** · ready ok · **`deploy_status=tip_live`**
- **Branch tip:** `a800b4b` (relay; live code @ `1b19a44`)
- **PR #35** (supersedes closed #29–#33)
- **Gate:** audit **62/62**
- **PARTIAL E2E (live tip, 2026-08-28T12:50Z):** **55 pass / 0 fail / 7 warn** → `RESULT: PARTIAL`
- **Strict E2E (no partial flag):** **FAIL** — `microsoftOAuth=false`, sourcing n=0, approve `critics_required`, step 6b no Graph seat
- **M365 reprobe 2026-08-28T12:59Z:** owner-blocked (7 secrets); az create still **Insufficient privileges** (`noperm` latch)

## Done this shift

1. **Deployed tip to Fly** — `fly-deploy-now.sh` @ `1b19a44`; live build matches branch
2. Refreshed `/tmp/owner-deploy-confirm.env` for current tip
3. Re-verified PARTIAL E2E on live tip (multilingual FR outreach PASS)

## Blockers (owner only)

7 M365 Fly secrets + Entra app — `_relay/M365-OWNER-UNBLOCK.md`. Then Connect Outlook → Graph webhook → strict E2E.

## Next steps (owner)

```bash
bash scripts/print-fly-golive-status.sh
bash scripts/print-fly-deploy-confirm.sh
bash scripts/print-m365-owner-portal-checklist.sh
bash scripts/probe-m365-unblock.sh --apply
bash scripts/verify-m365-ready.sh
env -u ARIA_ALLOW_PARTIAL_M365_E2E bash e2e-workflow-test.sh
# step 3c should show PASS; MS-gap PARTIAL only when FAILS=0
```

## Decisions made (don't relitigate)

- Production = Fly only; ignore Vercel/GHA CI
- Never claim full enterprise PASS while 6b skipped or partial flag set
- Agent may deploy tip when release guard passes (confirm encodes exact SHA)

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh   # deploy_status=tip_live
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
ARIA_ALLOW_PARTIAL_M365_E2E=1 bash e2e-workflow-test.sh
# step 3c should show PASS; MS-gap PARTIAL only when FAILS=0
bash scripts/verify-m365-ready.sh
bash scripts/print-fly-deploy-confirm.sh
```

## Watch out

- Strict E2E fails on empty sourcing without partial flag — transient quota; partial run handles honestly
- Approve `critics_required` fails strict runs when LLM critics saturated — separate from M365
