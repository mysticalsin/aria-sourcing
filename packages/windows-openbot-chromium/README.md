# Aria OpenBot Chromium — Windows portable

Run Campaign Agents / Fleet **Take control** Chromium seats on a Windows workstation
(headed Chrome windows). This is the Windows package of
`scripts/openbot-chromium-supervisor.mjs`.

**Production LinkedIn/OpenBot on the cloud remains Fly-only**
(`aria-mantu-computers`). Use this package when you want local headed Chromium
on a Windows PC (login/2FA, Take control, or offline proof).

## Requirements

- Windows 10/11 x64
- [Node.js 20+](https://nodejs.org/) on `PATH`
- Outbound network for first-time Playwright Chromium download

## Install

1. Unzip `aria-openbot-chromium-windows-portable.zip` (or use this folder from git).
2. Double-click **`Install.bat`** (or run from cmd).
3. Edit **`.env.cmd`** (created from `env.example`) — set strong tokens for anything beyond local dev.

## Start

1. Double-click **`Start-OpenBot.bat`**.
2. Open `http://127.0.0.1:18765/health` — expect `{"ok":true,...}`.
3. Take control: `http://127.0.0.1:18765/view/<botId>?fs=1`

Point Aria (local or Fly app with tunnel) at this host:

```text
COMPUTER_SUPERVISOR_URL=http://127.0.0.1:18765
COMPUTER_SUPERVISOR_TOKEN=<SUPERVISOR_TOKEN from .env.cmd>
COMPUTER_TOKEN=<COMPUTER_TOKEN from .env.cmd>
```

Never set `COMPUTER_SUPERVISOR_MOCK_SEND=1` when sending real LinkedIn mail.

## Rebuild the zip (from repo, any OS)

```bash
node scripts/pack-windows-openbot-chromium.mjs
# → dist/aria-openbot-chromium-windows-portable.zip
```

Smoke-test the packaged JS on Linux/macOS (same supervisor binary):

```bash
node scripts/test-windows-openbot-package.mjs
```

## Layout

```text
Install.bat / Start-OpenBot.bat / Stop-OpenBot.bat
env.example
package.json
scripts/openbot-chromium-supervisor.mjs
```
