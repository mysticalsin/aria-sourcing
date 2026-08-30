---
project: MSourcing / ARIA
shift: 334
agent: cursor-cloud
updated: 2026-08-29T03:45Z
status: tip-live-hermes-cloud-failover
---

# Handoff — Shift 334

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft
- **Live Fly:** `4732c4d` / **0073** · `deploy_status=tip_live` · Hermes unbound→cloud failover for loop tasks
- **PARTIAL E2E (on 9f143d1):** **RESULT: PARTIAL** · **42/0** · step **3c PASS** top-10 live
- **Microsoft:** **DEFERRED** · **LLM:** `llm_auth=dead` · no `/tmp/owner-llm.env`

## Done this shift

1. Found `/api/hermes/chat` returned `Aria runtime is not tenant-isolated` (no `HERMES_RUNTIME_WORKSPACE_ID`) **before** cloud failover — blocked live drafts even after LLM remint
2. Loop-task cloud failover on binding miss, missing Hermes base URL, and Hermes upstream failures
3. Tests + audit **64/64**; gate green

## Blockers

- Owner remint `/tmp/owner-llm.env` for live critics + real drafts
- Owner reopen Microsoft for Teams/Outlook book

## Next steps

```bash
# Microsoft path OFF unless owner re-enables.
unset AGENT_PROVIDER AGENT_MODEL
bash scripts/print-fly-golive-status.sh
bash scripts/print-fly-deploy-confirm.sh   # remint when tip_ahead_app
# deploy tip, then:
ls /tmp/owner-llm.env || true
bash scripts/run-enterprise-e2e-partial.sh
# expect step 3c PASS with provenance=live top-10
# after owner LLM: ARIA_ALLOW_PARTIAL_M365_E2E=1 bash e2e-workflow-test.sh  # no PARTIAL_LLM
# expect Agent provider: hermes when llm_auth=dead (not kimi); drafts via cloud failover
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
- Never pin auth-dead cloud AGENT_PROVIDER on Fly E2E — use live probe or hermes
- GitHub `language:` must be a real GH language; non-langs are keywords under primary language
- Unbound Hermes must not block loop-task cloud failover

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show”
- Do not re-arm `m365-secrets-reprobe` unless owner asks
- Shell may export stale AGENT_PROVIDER=kimi — E2E must clear it
