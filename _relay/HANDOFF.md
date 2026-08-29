---
project: MSourcing / ARIA
shift: 338
agent: cursor-cloud
updated: 2026-08-29T05:08Z
status: critics-pass-m365-partial-only
---

# Handoff — Shift 338

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft
- **Live Fly:** `ff27e74` / **0073** · `deploy_status=tip_ahead_docs` (tip `41f67de` = e2e/scripts/_relay only)
- **Gate:** `npx tsc --noEmit` + `npm test` green · audit matrix **64/64**
- **E2E verified:** `bash scripts/run-enterprise-e2e-partial.sh`
  - **RESULT: PARTIAL · 57 pass / 0 fail / 2 warn** (both Microsoft)
  - no `AGENT_PROVIDER unset` WARN — hermes/vault failover is info-only
  - step **3c PASS** top-10 live
  - **Human approval RECORDED** + **live LLM critics (stages=6)**
- **Microsoft:** **DEFERRED**

## Done this shift

1. Decoupled sourcing soft-skip from `PARTIAL_M365` → `ARIA_ALLOW_SKIP_SOURCING_E2E` only
2. Fixed recruiting-graph-stage auth probe to parse `.ok` / `.stage`
3. Fly reply `route=none` fail-closed unless `ARIA_ALLOW_SKIP_REPLY_CLASSIFY_E2E`
4. Cleared dishonest AGENT_PROVIDER WARN; refreshed audit matrix

## Blockers

- Owner reopen Microsoft for Teams/Outlook book (Graph seat + confirmLive)

## Next steps

```bash
unset AGENT_PROVIDER AGENT_MODEL
bash scripts/print-fly-golive-status.sh   # expect tip_ahead_docs or tip_live; live ff27e74
bash scripts/print-fly-deploy-confirm.sh   # remint /tmp/owner-deploy-confirm.env when tip_ahead_app
bash scripts/run-enterprise-e2e-partial.sh
# expect Running: ARIA_ALLOW_PARTIAL_M365_E2E=1 only
# expect step 3c PASS with provenance=live top-10
# expect Generated a LinkedIn draft via /api/hermes/chat (fr)
# expect Human approval RECORDED + live LLM critics used
# expect RESULT: PARTIAL until Microsoft reopened (2 Microsoft WARNs only)
# Do NOT set ARIA_ALLOW_PARTIAL_LLM_E2E / ARIA_ALLOW_SKIP_APPROVE_E2E unless regressing
```

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# step 3c should show PASS when running PARTIAL E2E
# Do NOT run verify-m365-ready / strict M365 E2E while Microsoft is deferred.
bash scripts/run-enterprise-e2e-partial.sh
```

## Decisions made (don't relitigate)

- Production = Fly only; ignore Vercel/GHA empty-steps
- PR #36 only (supersedes #29)
- **2026-08-29: Owner — don’t do the Microsoft part**
- Deploy confirm remint is agent-owned (non-secret)
- Never pin auth-dead cloud AGENT_PROVIDER on Fly E2E
- Never send `model:""` to `/api/hermes/chat`
- Unbound Hermes must not block loop-task cloud failover
- GitHub `language:` must be a real GH language
- E2E drafts must cite live candidate facts for empathy critics
- Partial wrapper default = M365 soft-fail only
- Sourcing soft-skip is NOT tied to PARTIAL_M365 (use ARIA_ALLOW_SKIP_SOURCING_E2E)

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show” + `print-fly-deploy-confirm`
- Do not re-arm `m365-secrets-reprobe` unless owner asks
- `llm_auth=dead` probe ≠ drafts/critics impossible (vault/failover)
- Do not edit `e2e-workflow-test.sh` while a live E2E bash process is running
