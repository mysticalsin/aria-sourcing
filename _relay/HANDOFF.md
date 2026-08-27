---
project: MSourcing / ARIA
shift: 186
agent: cursor-cloud
updated: 2026-08-27T19:25Z
status: tip-fixes-pending-deploy-still-blocked-on-secrets
---

# Handoff — Shift 186

## Current state

- **PR #32** · HEAD pending tip deploy after Outlook ensure + LLM failover fixes
- **Live Fly (pre-redeploy):** `dfa70ec` · ready · mig `0067` · Graph validationToken **200**
- **Still blocked for E2E PASS:** Fly `KIMI_API_KEY` → 401; no `MICROSOFT_CLIENT_ID/SECRET`
- Confirm: use `bash scripts/print-fly-deploy-confirm.sh` / `ARIA_PROD_DEPLOY_CONFIRM` (never invent)

## Done this shift

- Callback uses `ensureGraphMailSubscription` (reconnect-safe)
- Settings Enable webhook / Repair live seat when `seatMode !== "live"`
- `serverGenerateText` auth 401/403 → next configured LLM provider
- `e2e_uuid` openssl fallback; `.owner-llm.env` gitignore; allowlist LLM apply script
- Local `tsc` green; infra-release + email-connections green; audit 45/45 after HANDOFF fix

## Blockers

1. Rotate `KIMI_API_KEY` (or set OPENAI/ANTHROPIC — failover now skips dead Kimi on 401)
2. Paste `MICROSOFT_CLIENT_ID/SECRET` → Connect Outlook → Enable webhook
3. Full `e2e-workflow-test.sh` EXIT 0

## Next steps

1. Tip redeploy this HEAD (confirm via `print-fly-deploy-confirm.sh`)
2. Owner LLM + Microsoft drop-zones → apply scripts
3. Connect Outlook → Repair/Enable webhook → E2E

## Decisions made (don't relitigate)

- PR **#32**; Fly-only; local gate = CI authority
- Never invent Azure/LLM/confirm secrets (confirm from print-script formula OK)
- LinkedIn 409 assisted-manual; live calendar only `confirmLive` + seat `mode=live`

## Watch out

- Full FLY token via `tr -d '\n\r '` on `.fly-token.env`
- After GoTrue Azure secrets: tip redeploy flips `NEXT_PUBLIC_ENABLE_AZURE_LOGIN`
