---
project: MSourcing / ARIA
shift: 335
agent: cursor-cloud
updated: 2026-08-29T04:15Z
status: live-fr-drafts-partial-63
---

# Handoff — Shift 335

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft · tip `d245b23` (`tip_ahead_docs`)
- **Live Fly app:** `4732c4d` / **0073**
- **E2E (verified):** `ARIA_ALLOW_PARTIAL_M365_E2E=1 ARIA_ALLOW_PARTIAL_LLM_E2E=1 bash e2e-workflow-test.sh` → **RESULT: PARTIAL · 63 pass / 0 fail**
  - step **3c PASS** top-10 live
  - **live French** LinkedIn/Email/WhatsApp drafts via `/api/hermes/chat` (empty `model:""` bug fixed)
  - approve still soft-fails (`critics_required` / quality 422) under PARTIAL_LLM
- **Microsoft:** **DEFERRED** · **Fly env:** `llm_auth=dead` · no `/tmp/owner-llm.env`

## Done this shift

1. Fixed E2E `gen_draft` omitting empty `model` (Zod rejected `model:""` for hermes)
2. Verified live FR drafts + PARTIAL **63/0**

## Blockers

- Owner remint `/tmp/owner-llm.env` for stable multi-agent critics PASS (drop PARTIAL_LLM)
- Owner reopen Microsoft for Teams/Outlook book

## Next steps

```bash
unset AGENT_PROVIDER AGENT_MODEL
bash scripts/print-fly-golive-status.sh
bash scripts/print-fly-deploy-confirm.sh   # remint when tip_ahead_app
ls /tmp/owner-llm.env || true
ARIA_ALLOW_PARTIAL_M365_E2E=1 ARIA_ALLOW_PARTIAL_LLM_E2E=1 bash e2e-workflow-test.sh
# expect step 3c PASS with provenance=live top-10
# expect Generated a LinkedIn draft via /api/hermes/chat (fr)
# expect RESULT: PARTIAL 63/0 until owner LLM + Microsoft
# after owner LLM: drop ARIA_ALLOW_PARTIAL_LLM_E2E — expect critics PASS
```

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# step 3c should show PASS when running PARTIAL E2E
# Do NOT run verify-m365-ready / strict M365 E2E while Microsoft is deferred.
ARIA_ALLOW_PARTIAL_M365_E2E=1 ARIA_ALLOW_PARTIAL_LLM_E2E=1 bash e2e-workflow-test.sh
```

## Decisions made (don't relitigate)

- Production = Fly only; ignore Vercel/GHA empty-steps
- PR #36 only (supersedes #29)
- **2026-08-29: Owner — don’t do the Microsoft part**
- Deploy confirm remint is agent-owned (non-secret)
- Never pin auth-dead cloud AGENT_PROVIDER on Fly E2E — use live probe or hermes
- Never send `model:""` to `/api/hermes/chat`
- Unbound Hermes must not block loop-task cloud failover
- GitHub `language:` must be a real GH language

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show”
- Do not re-arm `m365-secrets-reprobe` unless owner asks
- `llm_auth=dead` probe ≠ drafts impossible (vault/failover may still draft)
- `run-enterprise-e2e-partial.sh` sets SKIP_APPROVE (42-pass path); for 63-pass live drafts use flags above without SKIP_APPROVE
