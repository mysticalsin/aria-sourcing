---
project: MSourcing / ARIA
shift: 306
agent: cursor-cloud
updated: 2026-08-28T21:55Z
status: post-send-mailbox-dryrun-clear
---

# Handoff — Shift 306

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft (reopened)
- **Live Fly:** `fc8b54a` / **0071** · tip **`8d44351`** pending remint
- **Audit:** **64/64** · **Gate:** green
- **M365:** `fly_m365_missing=7` · watcher armed · reprobe timer armed
- **LLM:** `llm_auth=dead`
- **Goal:** strict E2E PASS blocked on owner secrets

## Done this shift

1. Email send picks `isLiveMailboxSeat` only (not LinkedIn/WA seats)
2. Real send clears `dryRun: false`; refuse Send while dryRun
3. Seed: zero fabricated daily send counters; ledger `claimed` for dry-run Approved
4. Skills tone conversion uses `isRealSendFact` only
5. Recommendations: `send_outreach` for live Approved awaiting Send
6. Reopened PR #36 (was closed)

## Blockers

Owner: 7 M365 + live LLM remint + deploy confirm → Connect Outlook → Graph webhook → strict E2E

## Next steps

```bash
bash scripts/print-fly-golive-status.sh
bash scripts/probe-m365-unblock.sh --apply
bash scripts/fly-apply-owner-llm-secrets.sh
bash scripts/probe-fly-llm-auth.sh
bash scripts/print-fly-deploy-confirm.sh
bash scripts/fly-enterprise-golive-when-ready.sh
bash scripts/verify-m365-ready.sh
env -u ARIA_ALLOW_PARTIAL_M365_E2E -u ARIA_ALLOW_PARTIAL_LLM_E2E bash e2e-workflow-test.sh
# expect step 3c PASS with provenance=live; strict RESULT: PASS
```

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# step 3c should show PASS when running PARTIAL E2E; provenance / live=0 is quota
ARIA_ALLOW_PARTIAL_M365_E2E=1 ARIA_ALLOW_PARTIAL_LLM_E2E=1 bash e2e-workflow-test.sh
```

## Decisions made (don't relitigate)

- Production = Fly only; ignore Vercel/GHA
- PR #36 only; goal until strict Fly PASS

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show”
