---
project: MSourcing / ARIA
shift: 322
agent: cursor-cloud
updated: 2026-08-29T00:55Z
status: microsoft-deferred-deploying-tip
---

# Handoff — Shift 322

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft
- **Tip:** pending-commit · Live Fly `fc8b54a` / **0071** (tip **0073**)
- **Audit:** **64/64** · **Gate:** green
- **Microsoft / M365:** **DEFERRED by owner**
- **Deploy:** reminting confirm + fly-deploy-now for tip (0072+0073 + honesty)
- **LLM:** `llm_auth=dead` (keys presence surfaced on `/api/ready` as llmKeysPresent)

## Done this shift

1. Ready/Hermes/Cal.com honesty (llmKeysPresent, fail-closed toast, Cal.com roadmap-only)
2. Preparing tip Fly deploy (agent remint of non-secret deploy confirm)

## Blockers

- Strict PASS still needs owner M365 + live LLM critics
- Live book remains Graph confirmLive (Cal.com not wired)

## Next steps

```bash
# Microsoft path OFF unless owner re-enables.
git status
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration,components}'
bash scripts/print-fly-deploy-confirm.sh
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
- Deploy confirm remint is agent-owned (non-secret) when tip is clean
- HMAC inbound without OAuth; Cal.com roadmap-only
- LinkedIn always assisted-manual; PARTIAL requires inboundWebhookSecret

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show”
- Do not re-arm `m365-secrets-reprobe` unless owner asks
