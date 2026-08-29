---
project: MSourcing / ARIA
shift: 336
agent: cursor-cloud
updated: 2026-08-29T04:30Z
status: critics-pass-m365-partial-only
---

# Handoff — Shift 336

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft
- **Live Fly:** `ff27e74` / **0073** · `deploy_status=tip_live`
- **E2E verified:** `ARIA_ALLOW_PARTIAL_M365_E2E=1 bash e2e-workflow-test.sh` (**no** `PARTIAL_LLM`)
  - **RESULT: PARTIAL · 59 pass / 0 fail**
  - step **3c PASS** top-10 live
  - live FR drafts
  - **Human approval RECORDED** + **Multi-agent quality validation: live LLM critics used (stages=6)**
  - only Microsoft/calendar confirmLive skipped
- **Microsoft:** **DEFERRED** · no `/tmp/owner-llm.env` (env Kimi still dead; vault/failover powers drafts+critics)

## Done this shift

1. Root-caused approve flakes: generic openers → empathy 422; flaky critic JSON → 503
2. E2E drafts now include live candidate stack/GitHub/activity
3. Critics: retries 5, maxTokens 512, prose pass/score scrape
4. Verified critics PASS without PARTIAL_LLM

## Blockers

- Owner reopen Microsoft for Teams/Outlook book (Graph seat + confirmLive)

## Next steps

```bash
unset AGENT_PROVIDER AGENT_MODEL
bash scripts/print-fly-golive-status.sh   # expect tip_live ff27e74
bash scripts/print-fly-deploy-confirm.sh   # remint when tip_ahead_app
ARIA_ALLOW_PARTIAL_M365_E2E=1 bash e2e-workflow-test.sh
# expect step 3c PASS with provenance=live top-10
# expect Generated a LinkedIn draft via /api/hermes/chat (fr)
# expect Human approval RECORDED + live LLM critics used
# expect RESULT: PARTIAL until Microsoft reopened
# Do NOT set ARIA_ALLOW_PARTIAL_LLM_E2E unless critics regress
```

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# step 3c should show PASS when running PARTIAL E2E
# Do NOT run verify-m365-ready / strict M365 E2E while Microsoft is deferred.
ARIA_ALLOW_PARTIAL_M365_E2E=1 bash e2e-workflow-test.sh
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

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show”
- Do not re-arm `m365-secrets-reprobe` unless owner asks
- `llm_auth=dead` probe ≠ drafts/critics impossible (vault/failover)
- `run-enterprise-e2e-partial.sh` still sets SKIP_APPROVE + PARTIAL_LLM when probe dead — prefer explicit flags above for critics proof
