---
project: MSourcing / ARIA
shift: 185
agent: cursor-cloud
updated: 2026-08-27T19:10Z
status: tip-live-blocked-on-kimi-401-and-microsoft-secrets
---

# Handoff — Shift 185

## Current state

- **PR #32** · tip `dfa70ec` live; baton commit `c898c40`+ (uuidgen/LLM apply in flight)
- **Live Fly:** ready · build=`dfa70ec7c21ad1aec394130b9d5853c63e92acef` · mig=`0067_mcp_allowlist_select_grants.sql` · Graph validationToken **200**
- **E2E tip run** (`/tmp/e2e-tip-dfa70ec.log`): **31 passed, 11 failed**, EXIT 1
  - Intake: `Upstream kimi HTTP 401` (Fly `KIMI_API_KEY` present, `KIMI_BASE_URL=https://api.kimi.com/coding/v1`, models probe 401 invalid/expired)
  - Webhook hiring_need queued `requisition_parse` but no campaign in 180s (parse needs LLM)
  - `microsoftOAuth=false` — no `MICROSOFT_CLIENT_ID/SECRET`
  - No live Graph seat → step 6b fail-closed (expected)
  - `uuidgen` missing broke Idempotency-Key → fixed in `e2e-workflow-test.sh` (`e2e_uuid`)
- **Watchers:** `watch-owner-microsoft`, `watch-owner-llm` (tmux)
- **Drop zones:** `/tmp/owner-microsoft.env`, `/tmp/owner-llm.env` (examples under `production-readiness/`)

## Done this shift

- Tip golive confirmed (ready/mig/Graph 200)
- Full E2E against tip; evidence logged
- Portable `e2e_uuid` in `e2e-workflow-test.sh`
- `scripts/fly-apply-owner-llm-secrets.sh` + `.owner-llm.env.example`
- Cursor setup actions: rotate KIMI_API_KEY + MICROSOFT_* + Entra app

## Blockers

1. **KIMI_API_KEY invalid/expired on Fly** — rotate via Cursor secret or `/tmp/owner-llm.env` → `bash scripts/fly-apply-owner-llm-secrets.sh`
2. **MICROSOFT_CLIENT_ID/SECRET missing** — Entra admin; noperm latch on `az ad app create`
3. After both: Connect Outlook → Enable webhook → `bash e2e-workflow-test.sh` EXIT 0

## Next steps

1. Owner pastes working `KIMI_API_KEY` (or OPENAI/ANTHROPIC) + MICROSOFT_*
2. Apply scripts + Connect Outlook / Enable webhook
3. `eval "$(bash scripts/print-fly-e2e-env.sh --export)" && bash e2e-workflow-test.sh`
4. Goal complete only on full E2E PASS (no `ARIA_ALLOW_SKIP_LIVE_CALENDAR=1`)

## Decisions made (don't relitigate)

- PR **#32**; Fly-only; local gate = CI authority
- Never invent Azure/LLM secrets
- LinkedIn 409 assisted-manual; live calendar only `confirmLive` + seat `mode=live`
- Migration ≥ 0066

## Watch out

- Full FLY token via `tr -d '\n\r '` on `.fly-token.env`
- Tip deploy already done — prefer not force-redeploy unless LLM/MS secret set requires machine recycle (secrets set does)
