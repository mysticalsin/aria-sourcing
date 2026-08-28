---
project: MSourcing / ARIA
shift: 288
agent: cursor-cloud
updated: 2026-08-28T13:45Z
status: owner-wait-m365-strict-pass
---

# Handoff — Shift 288

## Current state

- **Live Fly:** `1b19a44` / **0071** · ready ok · **`deploy_status=tip_live`**
- **Branch tip:** `4b4b727` (PR #36 relay; live code @ `1b19a44`)
- **PR #36** (draft; supersedes closed-without-merge #35)
- **Gate (2026-08-28T13:45Z):** `npx tsc --noEmit` green · audit **62/62**
- **PARTIAL E2E (live, 2026-08-28T13:45Z):** **55 pass / 0 fail / 7 warn** → `RESULT: PARTIAL`
- **Strict E2E:** blocked — M365 (7 secrets) + step 6b
- **M365 reprobe 2026-08-28T13:45Z:** owner-blocked — `fly_m365_missing=7`, zero Entra `*.fly.dev` apps, `/tmp/owner-microsoft.env` absent

## Done this shift

1. **Deployed tip to Fly** — `fly-deploy-now.sh` @ `1b19a44`; live build matches code tip
2. Re-verified gate + PARTIAL E2E on live (multilingual FR outreach PASS; 55/0/7)
3. Hardened strict Fly E2E retries (sourcing×4, approve×5) for post-M365 transient quota/critic saturation
4. Re-probed M365; watcher active; setup actions re-requested

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
