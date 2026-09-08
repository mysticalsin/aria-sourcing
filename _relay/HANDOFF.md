---
project: MSourcing / ARIA
shift: 110
agent: cursor-cloud
updated: 2026-09-08T15:55Z
status: fly-openbot-live-cf-e2e-green
---

# Handoff — Shift 110

## Current state

- **Branch:** `cursor/linkedin-auto-vm-fleet-b91d` @ `ebcb4d8`
- **Production:** https://aria-mantu-app.fly.dev (Fly only)
- **Live OpenBot LLM:** same-key via `CLOUDFLARE_WORKERS_AI_SECRET` → intake-llm worker
  - `GET /api/openbot/v1/models` → `aria:cloudflare_workers_ai` HTTP 200
  - `POST /api/openbot/v1/chat/completions` → live Llama `FLY_OPENBOT_OK` HTTP 200
  - wrong Bearer → 401
- **Workflow gate:** `openbot-fly-workflow-e2e` 21/21 (10 agents / 10 VMs)
- **Evidence:** `_relay/evidence/2026-09-08-fly-openbot-live-cf-e2e.md`
- **Video artifact:** `/opt/cursor/artifacts/fly-openbot-live-e2e-demo.mp4` (~129s)

## Done this shift

1. Deployed branch image to Fly (`fly deploy --config fly.app.toml --remote-only`)
2. DeepSeek/Kimi keys on Fly invalid upstream; wired CF Workers AI as OpenBot same-key spend path
3. Verified live Fly OpenBot chat with real Llama reply
4. Recorded full E2E walkthrough video with real results

## Blockers (live Chromium LinkedIn)

1. Separate OpenBot supervisor host for N Chromiums
2. `COMPUTER_SUPERVISOR_*` + per-seat LinkedIn login via Fleet Take control

## Next steps

1. Owner: provision OpenBot supervisor + set `COMPUTER_SUPERVISOR_*` on Fly
2. Rotate any DeepSeek key that was pasted in chat (invalid anyway)
3. Optional: replace CF with a fresh DeepSeek/OpenAI key when available (`OPENBOT_LLM_PROVIDER`)

## Decisions made (don't relitigate)

- Production = Fly only
- Automatic LinkedIn = OpenBot Browser Computer
- 1 agent seat = 1 OpenBot Chromium
- OpenBot LLM uses Aria same-key (PROVIDER_ENV or CLOUDFLARE_WORKERS_AI_SECRET)

## Watch out

- Never `COMPUTER_SUPERVISOR_MOCK_SEND=1` on prod
- Do not commit secrets; wipe `/tmp/aria-e2e/*` keys after ops
