---
project: MSourcing / ARIA
shift: 317
agent: cursor-cloud
updated: 2026-08-29T00:13Z
status: microsoft-deferred-non-ms-honesty
---

# Handoff — Shift 317

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft (supersedes #29)
- **Tip:** ee0818b · Live Fly `fc8b54a` / **0071** (tip **0072**)
- **Audit:** **64/64** · **Gate:** green (`npx tsc --noEmit && npm test`)
- **Microsoft / M365:** **DEFERRED by owner** — no Entra/Graph secrets, no Outlook connect, no `verify-m365-ready` / strict M365 E2E
- **LLM:** `llm_auth=dead` (only pursue if owner asks)
- Non-MS honesty: LinkedIn always manual; PARTIAL requires inbound webhook; EmptyState hydrate on campaigns/candidates/replies/funnel

## Done this shift

1. LinkedIn dry-run → always `Pending Manual Send` (`planOutreachApprovalDelivery`); UI `approvedPendingSend` excludes LinkedIn
2. PARTIAL E2E fails closed without `inboundWebhookSecret` (HMAC ≠ Graph)
3. EmptyState hydrate: campaigns, campaigns/[id], candidates (+ Suspense), replies, funnel
4. Audit pins for LinkedIn / PARTIAL webhook / Loading * EmptyStates; restored `print-fly-deploy-confirm` + step 3c PASS phrases → **64/64**
5. Gate green

## Blockers

- Full objective strict PASS still needs owner-reopened Microsoft/M365 + live LLM (deferred)
- Live Fly behind tip migration **0072**; deploy-confirm remint only if owner asks

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
- **2026-08-29: Owner — don’t do the Microsoft part** (no Entra/Graph secrets apply, no Outlook connect chase, no strict M365 gate until re-opened)
- LinkedIn is always assisted-manual (`Pending Manual Send`) in dry-run and live — never Approved + Send now
- PARTIAL E2E still requires `inboundWebhookSecret` (HMAC intake ≠ Graph)
- Loop live book path is `confirm-calendar-book`; propose cron stays dry-run

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show”
- Do not re-arm `m365-secrets-reprobe` or restart Microsoft watcher unless owner asks
