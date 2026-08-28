---
project: MSourcing / ARIA
shift: 289
agent: cursor-cloud
updated: 2026-08-28T15:38Z
status: owner-wait-m365-strict-pass
---

# Handoff — Shift 289

## Current state

- **Live Fly:** `2d25f5f` / **0071** · ready ok · **`deploy_status=tip_live`**
- **Branch tip:** `2d25f5f` (PR #36; live matches tip)
- **PR #36** (draft; supersedes closed-without-merge #29–#35)
- **Gate:** `npx tsc --noEmit` green · audit **62/62** · npm test green
- **PARTIAL E2E (live, 2026-08-28T15:38Z):** **59 pass / 0 fail / 9 warn** → `RESULT: PARTIAL`
- **Strict E2E:** blocked — M365 (7 secrets) + step 6b
- **M365 reprobe 2026-08-28T15:14Z:** owner-blocked — `fly_m365_missing=7`, `/tmp/owner-microsoft.env` absent

## Done this shift

1. Fixed manifest contract pins for `outreach-language` suite (gate was red)
2. Hardened PARTIAL approve: Fly×5 retries + warn on 422 after exhaustion
3. **Webhook-only intake:** `/api/email/sync` 403 unless `ARIA_ALLOW_INBOX_SYNC=1`; hide Emergency sync CTAs; Graph HMAC Validate honesty; Entra login honesty
4. **Deployed tip to Fly** — `fly-deploy-now.sh` @ `2d25f5f`; PARTIAL E2E 59/0/9 on live
5. M365 watcher active; setup actions re-requested

## Blockers (owner only)

7 M365 Fly secrets + Entra app — `_relay/M365-OWNER-UNBLOCK.md`. Then Connect Outlook → Graph webhook → strict E2E.

## Next steps (owner)

```bash
bash scripts/print-m365-owner-portal-checklist.sh
bash scripts/probe-m365-unblock.sh --apply
# Settings → Connect Outlook (live) → Enable Graph webhook
bash scripts/verify-m365-ready.sh          # step 6b must pass
env -u ARIA_ALLOW_PARTIAL_M365_E2E bash e2e-workflow-test.sh
```

## Decisions made (don't relitigate)

- Production = Fly only; ignore Vercel/GHA CI (jobs die with 0 steps)
- Never claim full enterprise PASS while 6b skipped or partial flag set
- Agent may deploy tip when release guard passes (confirm encodes exact SHA)
- Inbox list-poll is off unless `ARIA_ALLOW_INBOX_SYNC=1` (webhook-only production)
- Tony HOLD: do not open another PR; keep #36; no parallel ship

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh   # deploy_status=tip_live
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
ARIA_ALLOW_PARTIAL_M365_E2E=1 bash e2e-workflow-test.sh
bash scripts/verify-m365-ready.sh
env -u ARIA_ALLOW_PARTIAL_M365_E2E bash e2e-workflow-test.sh
```

## Watch out

- Strict E2E fails on empty sourcing without partial flag — transient quota
- Approve 422/503 after retries → PARTIAL warn only when `ARIA_ALLOW_PARTIAL_M365_E2E=1`
- GHA CI fails instantly with 0 steps — ignore; local + Fly are authoritative
