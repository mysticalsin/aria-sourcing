# Live Fly OpenBot same-key E2E (2026-09-08)

**Host:** https://aria-mantu-app.fly.dev  
**Commit deployed:** `ebcb4d8` (branch `cursor/linkedin-auto-vm-fleet-b91d`)  
**Provider:** `cloudflare_workers_ai` via `CLOUDFLARE_WORKERS_AI_SECRET` + intake-llm worker  
**Secret was not committed.**

## Result

| Step | Result |
| --- | --- |
| `GET /api/health` | healthy |
| Bearer = Aria CF secret → `GET /api/openbot/v1/models` → `aria:cloudflare_workers_ai` | HTTP 200 |
| `POST /api/openbot/v1/chat/completions` live Llama → `FLY_OPENBOT_OK` | HTTP 200 |
| Wrong Bearer | HTTP 401 Unauthorized |
| `openbot-fly-workflow-e2e` 10 agents / 10 VMs | 21/21 |

## Notes

- Operator DeepSeek key and Fly `KIMI_API_KEY` are invalid upstream; CF Workers AI is the live spend path on Fly.
- Rotate any DeepSeek key that was pasted in chat.
- Live LinkedIn Chromium still needs a separate OpenBot supervisor host (`COMPUTER_SUPERVISOR_*`).
