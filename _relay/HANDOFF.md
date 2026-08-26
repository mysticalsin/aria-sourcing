---
project: MSourcing / ARIA
shift: 90
agent: cursor-cloud
updated: 2026-08-26 UTC
status: settings-ai-key-ux
---

# Handoff - Shift 90

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · #29 · commit `d29a312`
- Settings → **AI & Models** has a primary **Add an API key** card: paste → encrypt → clear input → show `••••last4` → live provider probe → auto-wire LLM provider on success
- Same encrypt+verify copy on Access & Keys (`api-keys-panel.tsx`)
- Local proof artifacts: `/opt/cursor/artifacts/settings-ai-add-key-card.png`, `settings-ai-key-after-add.png`
- Fly redeploy for `d29a312` in progress (`fly-redeploy-ai2` / `/tmp/fly-redeploy-ai.log`); live was still on older `ba88302` before this redeploy

## Done this shift

- Rewrote `src/components/settings/providers-panel.tsx` for simple add-key UX
- Aligned `api-keys-panel.tsx` + section title/description on settings AI tab
- `npx tsc --noEmit` green; `tests/llm-key-probe.mts` 11 passed
- Manual local: fake Anthropic key encrypted, input cleared, `invalid` badge + toast

## Blockers

- Wait for Fly redeploy to finish so https://aria-mantu-app.fly.dev/settings?tab=ai matches branch

## Next steps

1. Confirm `/api/ready` build SHA = `d29a312…` after deploy
2. On Fly (admin): add real Anthropic/OpenAI key → verified + provider wired
3. Optional: E2E intake→source with that key

## Decisions made (don't relitigate)

- Only wire/create matching LLM provider when live verify status is `valid`
- Google/OpenRouter remain format-check only; Anthropic/OpenAI/Groq/xAI/Mistral/Kimi live-verify
- Do not commit secrets to `_relay/`

## Watch out

- Failed verify still stores the encrypted key as `invalid` — Delete then re-add
- Vault use requires `status === "valid"` (`resolveVaultSecret`)
- Probe ≠ full recruitment E2E (still need provider enabled + model picker)
