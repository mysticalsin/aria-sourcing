---
project: MSourcing / ARIA
shift: 86
agent: cursor-cloud
updated: 2026-08-26 UTC
status: llm-key-verify-live
---

# Handoff - Shift 86

## Current state

- **Production:** https://aria-mantu-app.fly.dev · version **41** · migration **0060**
- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · #29
- Settings → AI (`?tab=ai`) can **Add & verify LLM API key**: encrypt via `/api/keys`, live probe via `/api/keys/test` for Anthropic/OpenAI/Groq/xAI/Mistral/Kimi
- Live E2E: fake Anthropic key → `valid:false` HTTP 401 authentication_error; malformed → format reject
- UI artifact: `/opt/cursor/artifacts/ai-settings-add-verify-key.png`
- Multi-provider sourcing (shift 85) remains live

## Done this shift

- `src/lib/ai/key-probe.ts` live models-list probes
- `/api/keys/test` routes LLM providers through live probe (format fallback on network fail)
- ProvidersPanel: Add & verify form + Verify on linked keys; filtered key dropdown by provider
- ApiKeysPanel: save auto-verifies; button renamed Verify
- Tests: `tests/llm-key-probe.mts`

## Blockers

- `/api/ready` release-identity lag / agentFrameworks false (expected)

## Next steps

1. Operator: Settings → AI → Add key → paste real Anthropic/OpenAI/… secret → Save, encrypt & verify → enable provider
2. Optional: bind verified key on Kimi/Anthropic row and run a cloud sourcing agent pass

## Decisions made (don't relitigate)

- Live LLM probes use GET /models (cheap auth); 401/403 = invalid; 429/402/400 after auth = valid
- Vault still requires `status === "valid"` before `resolveVaultSecret` decrypts for egress
- Do not commit secrets/passwords into `_relay/` / git

## Watch out

- Kimi vault provider string is `Kimi (Moonshot)` while LLM kind is `Kimi` — panel maps via `vaultProviderForKind`
- Verify button on a provider row only appears when a key is already linked
