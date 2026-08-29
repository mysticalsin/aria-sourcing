---
project: MSourcing / ARIA
shift: 330
agent: cursor-cloud
updated: 2026-08-29T02:30Z
status: tip-ahead-app-critics-hermes
---

# Handoff — Shift 330

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft
- **Tip:** critics Hermes-first (needs Fly deploy — `tip_ahead_app`)
- **Live Fly (app):** `9d35948` / **0073** (pre-fix)
- **PARTIAL E2E (last):** **62/0** — approve critics soft-failed under dead Kimi (pre-fix)
- **Microsoft / M365:** **DEFERRED**
- **LLM:** `llm_auth=dead` · Hermes runtime ready — critics now use `resolveLoopLlm`

## Done this shift

1. Workspace outreach critics → `resolveLoopLlm` (Hermes-first → cloud), matching draft cron
2. Demo path keeps `serverGenerateText` env-only; fail-closed when all dead
3. Tests: `outreach-quality-live-hermes`; audit pin; manifest 193/246

## Blockers

- Strict PASS still needs owner M365 reopen (calendar/Teams)
- Owner LLM remint still required if Hermes down / cloud-only path
- Deploy tip for critics fix before re-running PARTIAL for approve path

## Next steps

```bash
# Microsoft path OFF unless owner re-enables.
bash scripts/print-fly-golive-status.sh   # expect tip_ahead_app after this tip
bash scripts/print-fly-deploy-confirm.sh
# remint /tmp/owner-deploy-confirm.env then:
bash scripts/fly-deploy-now.sh
ARIA_ALLOW_PARTIAL_M365_E2E=1 ARIA_ALLOW_PARTIAL_LLM_E2E=1 bash e2e-workflow-test.sh
# expect step 3c PASS with provenance=live; provenance / live=0 is quota
# expect approve critics to use Hermes when cloud llm_auth=dead
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
- Deploy confirm remint is agent-owned (non-secret)
- Workspace critics share Hermes-first stack with loop drafts (`resolveLoopLlm`)
- Docs/ops tip-ahead → `tip_ahead_docs`; app tip-ahead → `tip_ahead_app`

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show”
- Do not re-arm `m365-secrets-reprobe` unless owner asks
