---
project: MSourcing / ARIA
shift: 321
agent: cursor-cloud
updated: 2026-08-29T00:50Z
status: microsoft-deferred-hmac-mailbox
---

# Handoff — Shift 321

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft (supersedes #29)
- **Tip:** 3ca31fe · Live Fly `fc8b54a` / **0071** (tip **0073**)
- **Audit:** **64/64** · **Gate:** green
- **Microsoft / M365:** **DEFERRED by owner**
- **CI:** GHA empty-steps + Vercel rate-limit — **ignore**
- **LLM:** `llm_auth=dead`
- HMAC mailbox registration without OAuth (migration **0073** + Settings UI) — needs tip deploy to activate on Fly

## Done this shift

1. Confirmed CI noise (empty-steps + Vercel rate-limit) — ignored
2. **0073** `upsert_hmac_inbound_mailbox_route` + `register_hmac_mailbox` API + Settings HMAC form
3. Prior: pre_call→first_interview_book chain; append_booking soft-fail; EmptyState sweep

## Blockers

- Strict PASS needs owner M365/LLM + tip deploy (**0072**+**0073**)

## Next steps

```bash
# Microsoft path OFF unless owner re-enables.
git status
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
bash scripts/print-fly-deploy-confirm.sh
# Non-MS PARTIAL only (M365 deferred):
ARIA_ALLOW_PARTIAL_M365_E2E=1 ARIA_ALLOW_PARTIAL_LLM_E2E=1 bash e2e-workflow-test.sh
# expect step 3c PASS with provenance=live; provenance / live=0 is quota
```

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# step 3c should show PASS when running PARTIAL E2E; provenance / live=0 is quota
# Do NOT run verify-m365-ready / strict M365 E2E while Microsoft is deferred.
ARIA_ALLOW_PARTIAL_M365_E2E=1 ARIA_ALLOW_PARTIAL_LLM_E2E=1 bash e2e-workflow-test.sh
```

## Decisions made (don't relitigate)

- Production = Fly only; ignore Vercel/GHA empty-steps
- PR #36 only (supersedes #29)
- **2026-08-29: Owner — don’t do the Microsoft part**
- LinkedIn always assisted-manual; PARTIAL still requires inboundWebhookSecret
- HMAC inbound mailbox registration does not require OAuth/Outlook
- Loop live book = `confirm-calendar-book`; propose cron dry-run
- Dry-run pre_call advances to first_interview_book

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show”
- Do not re-arm `m365-secrets-reprobe` unless owner asks
- HMAC register returns 503 until Fly applies **0073**
