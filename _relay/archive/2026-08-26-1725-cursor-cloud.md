---
project: MSourcing / ARIA
shift: 90
agent: cursor-cloud
updated: 2026-08-26 UTC
status: settings-ai-key-ux
---

# Handoff - Shift 90

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · #29 · commit `591a813`
- Settings → **AI & Models**: primary **Add an API key** → encrypt → clear input → `••••last4` → live probe in same `POST /api/keys` → auto-wire provider on success
- Local proof: fake Anthropic key → toast "Encrypted, but live verification failed" with HTTP 401 from Anthropic; input cleared; red **invalid** badge
- Artifacts: `/opt/cursor/artifacts/settings-ai-add-key-card.png`, `settings-ai-encrypt-verify-result.png`
- Fly deploy for `591a813` reported OK, but `/api/ready` + machine `ARIA_RELEASE_SHA` still showed older `ba88302` (release-identity lag) — re-check / force image

## Done this shift

- Providers panel rewrite + Access & Keys align
- `POST /api/keys` encrypt-then-verify (LLM + sourcing probes)
- Store/UI consume save-time `valid`/`detail`
- tsc + llm-key-probe green; local E2E screenshot

## Blockers

- Confirm Fly actually serves `591a813` (ready SHA still lagging)

## Next steps

1. Verify live https://aria-mantu-app.fly.dev/settings?tab=ai shows Add an API key card
2. Admin: paste real Anthropic/OpenAI key → verified + provider wired
3. Optional: fix release-identity / ARIA_RELEASE_SHA drift on Fly

## Decisions made (don't relitigate)

- Only auto-wire LLM provider when verify status is `valid`
- Google/OpenRouter format-check only; Anthropic/OpenAI/Groq/xAI/Mistral/Kimi live-verify
- Do not commit secrets to `_relay/`

## Watch out

- Failed verify still stores encrypted key as `invalid` — Delete then re-add
- Vault use requires `status === "valid"`
- Probe ≠ full recruitment E2E (provider enabled + model picker still needed)
