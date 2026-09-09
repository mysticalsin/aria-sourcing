# Fly-only campaign Agents + Chromium supervisor (2026-09-09)

**Never Vercel** for this path.

| Service | URL | Role |
| --- | --- | --- |
| Aria web | https://aria-mantu-app.fly.dev | Campaign Agents / Fleet orchestration |
| OpenBot Chromium | https://aria-mantu-computers.fly.dev | 1 seat = 1 Chromium (`max=5`) |

## Verified live

| Check | Result |
| --- | --- |
| `GET https://aria-mantu-app.fly.dev/api/health` | healthy |
| App CSP `frame-src` includes `https://aria-mantu-computers.fly.dev` | yes |
| App env `COMPUTER_SUPERVISOR_URL` | `https://aria-mantu-computers.fly.dev` |
| `GET https://aria-mantu-computers.fly.dev/health` | `{"ok":true,...,"max":5}` |
| `POST .../computers/comp_fly_smoke/ensure` | running + `viewUrl` on Fly host |
| Navigate LinkedIn via agent-computer | LinkedIn login page title returned |

## Deploy artifacts

- `fly.computers.toml` + `Dockerfile.computers` → `aria-mantu-computers`
- `fly.app.toml` `[env] COMPUTER_SUPERVISOR_URL` + secrets `COMPUTER_SUPERVISOR_TOKEN` / `COMPUTER_TOKEN` / `OPENBOT_COMPUTER_TOKEN`
- Branch: `cursor/campaign-agent-vm-control-b91d`

## Operator path on Fly

1. Open https://aria-mantu-app.fly.dev → campaign → **Agents**
2. Start VM / Observe / Take control / Release
3. Live viewport iframes `https://aria-mantu-computers.fly.dev/view/:botId`

## Guardrails

- Do not set `COMPUTER_SUPERVISOR_*` on Vercel
- Never `COMPUTER_SUPERVISOR_MOCK_SEND=1` on Fly prod
- Tokens only via `fly secrets` (not committed)
