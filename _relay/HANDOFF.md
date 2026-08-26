---
project: MSourcing / ARIA
shift: 92
agent: cursor-cloud
updated: 2026-08-26 UTC
status: llm-key-e2e-strict
---

# Handoff - Shift 92

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · #29
- Strict E2E of Settings → AI encrypt+verify completed locally
- **Critical fix:** NVIDIA NIM hosted `GET /models` is public (200 with no/invalid auth) — probe now uses chat/completions only; default model set to `nvidia/llama-3.1-nemotron-70b-instruct` (EOL llama-3.3-70b removed)
- `formatValid` on `POST /api/keys` now reflects format check, not probe result
- Live tests: `tests/llm-key-probe-live.mts` registered in manifest
- Artifacts: `settings-ai-provider-dropdown.png`, `settings-ai-e2e-saved-keys.png`

## Done this shift

- Live network probes: Anthropic/DeepSeek/Kimi 401, NVIDIA 403 for fake keys
- UI E2E: DeepSeek, NVIDIA NIM, Kimi all encrypt → clear → ••••last4 → invalid
- API E2E via demo cookie against local `next start`

## Blockers

- No real provider keys in env — positive (valid) path not exercised live
- Fly release identity may still lag

## Next steps

1. Redeploy Fly with this branch
2. Optional: positive-path verify with a real NVIDIA/DeepSeek/Kimi key in a secrets-capable env

## Decisions made (don't relitigate)

- Never use NVIDIA public /models as an auth probe
- Do not commit secrets to `_relay/`

## Watch out

- Hosted NIM model catalog churn/EOL (410) — keep default model on a live auth-gated id
