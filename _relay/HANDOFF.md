---
project: MSourcing / ARIA
shift: 337
agent: cursor-cloud
updated: 2026-08-29T04:50Z
status: critics-pass-m365-partial-only
---

# Handoff — Shift 337

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft
- **Live Fly:** `ff27e74` / **0073** · `deploy_status=tip_ahead_docs` (tip `1a9b981` = scripts/_relay only; no redeploy)
- **Gate:** `npx tsc --noEmit` + `npm test` green · `audit-fixes` 50/50
- **E2E verified:** `bash scripts/run-enterprise-e2e-partial.sh` (**no** PARTIAL_LLM / SKIP_APPROVE)
  - flags: `ARIA_ALLOW_PARTIAL_M365_E2E=1` only
  - **RESULT: PARTIAL · 57 pass / 0 fail**
  - step **3c PASS** top-10 live
  - live FR drafts via Hermes/vault failover
  - **Human approval RECORDED** + **live LLM critics used (stages=6)**
  - only Microsoft/calendar confirmLive skipped
- **Microsoft:** **DEFERRED** · Fly env `llm_auth=dead` (vault/failover powers drafts+critics)

## Done this shift

1. `run-enterprise-e2e-partial.sh` no longer auto-sets SKIP_APPROVE or PARTIAL_LLM from Fly env probe
2. Re-verified wrapper → PARTIAL 57/0 with critics PASS
3. Gate green after tip `1a9b981`

## Blockers

- Owner reopen Microsoft for Teams/Outlook book (Graph seat + confirmLive)

## Next steps

```bash
unset AGENT_PROVIDER AGENT_MODEL
bash scripts/print-fly-golive-status.sh   # expect tip_ahead_docs or tip_live; live ff27e74
bash scripts/run-enterprise-e2e-partial.sh
# expect Running: ARIA_ALLOW_PARTIAL_M365_E2E=1 only
# expect step 3c PASS with provenance=live top-10
# expect Generated a LinkedIn draft via /api/hermes/chat (fr)
# expect Human approval RECORDED + live LLM critics used
# expect RESULT: PARTIAL until Microsoft reopened
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
- Partial wrapper default = M365 soft-fail only (not SKIP_APPROVE / not PARTIAL_LLM from env probe)

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show”
- Do not re-arm `m365-secrets-reprobe` unless owner asks
- `llm_auth=dead` probe ≠ drafts/critics impossible (vault/failover)
- Opt-in only: `ARIA_ALLOW_SKIP_APPROVE_E2E=1` / `ARIA_ALLOW_PARTIAL_LLM_E2E=1` / `ARIA_ALLOW_CANNED_DRAFT_E2E=1`
