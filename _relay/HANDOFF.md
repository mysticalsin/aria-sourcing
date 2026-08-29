---
project: MSourcing / ARIA
shift: 335
agent: cursor-cloud
updated: 2026-08-29T04:05Z
status: e2e-omit-empty-model-live-drafts
---

# Handoff — Shift 335

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft
- **Live Fly app:** `4732c4d` / **0073** · Hermes unbound→cloud failover
- **Tip:** e2e omits empty `model:""` for hermes (Zod was rejecting drafts) · `tip_ahead_docs`
- **Microsoft:** **DEFERRED** · **Fly env LLM:** `llm_auth=dead` (Kimi 401) but workspace/cloud failover can still produce French drafts
- **No** `/tmp/owner-llm.env`

## Done this shift

1. Diagnosed E2E draft FAIL: `OUTREACH_MODEL=""` for hermes → `model:""` → Zod Invalid → empty subject/body
2. Fixed `gen_draft` to omit `model` when empty; hardened prompt (no clarifying questions)
3. Smoke: French LinkedIn draft + `assert-outreach-language fr` PASS

## Blockers

- Owner remint `/tmp/owner-llm.env` if vault/failover is insufficient for critics
- Owner reopen Microsoft for Teams/Outlook book

## Next steps

```bash
unset AGENT_PROVIDER AGENT_MODEL
bash scripts/print-fly-golive-status.sh
bash scripts/print-fly-deploy-confirm.sh   # remint when tip_ahead_app
ls /tmp/owner-llm.env || true
# Prefer live drafts (no CANNED) when failover works:
ARIA_ALLOW_PARTIAL_M365_E2E=1 bash e2e-workflow-test.sh
# expect step 3c PASS with provenance=live top-10
# expect Generated a LinkedIn draft via /api/hermes/chat (fr)
# expect approve critics path (or critics_required soft-fail only with PARTIAL_LLM)
bash scripts/run-enterprise-e2e-partial.sh   # still OK when LLM probe dead
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
- Never pin auth-dead cloud AGENT_PROVIDER on Fly E2E — use live probe or hermes
- Never send `model:""` to `/api/hermes/chat`
- Unbound Hermes must not block loop-task cloud failover
- GitHub `language:` must be a real GH language

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show”
- Do not re-arm `m365-secrets-reprobe` unless owner asks
- `llm_auth=dead` probe ≠ drafts impossible (vault/failover may still work)
