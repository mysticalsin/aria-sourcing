---
project: MSourcing / ARIA
shift: 122
agent: cursor-cloud
updated: 2026-09-09T17:45Z
status: windows-openbot-pack-shipped
---

# Handoff — Shift 122

## Current state

- **Branch:** `cursor/windows-openbot-chromium-pack-b91d` (from campaign tip `94ca1b8`)
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/77 (base: `cursor/campaign-agent-vm-control-b91d`)
- **Prior PR:** https://github.com/mysticalsin/aria-sourcing/pull/76 (Fly interactive Take control)
- **Windows portable zip:** rebuild with `node scripts/pack-windows-openbot-chromium.mjs` → `dist/aria-openbot-chromium-windows-portable.zip`
- **Smoke evidence:** `_relay/evidence/windows-openbot-pack-smoke.json` (`ok: true` on this Linux agent host)
- **Artifact zip:** `/opt/cursor/artifacts/aria-openbot-chromium-windows-portable.zip`

## Done this shift

1. Windows-safe supervisor paths (`os.tmpdir`, win32 Chrome candidates, Windows UA)
2. `packages/windows-openbot-chromium/` Install/Start/Stop `.bat` + README
3. Pack + smoke scripts; smoke passed (pack → install → health → ensure → view?fs=1 → take → click-xy)
4. Pushed branch + opened PR #77

## Blockers

1. This device is Linux — cannot natively run `.bat`/headed Windows Chrome UI; smoke covers packaged JS + launcher contents
2. Operator still must complete LinkedIn login/2FA once on Fly (or on Windows package) — credentials not in agent env

## Next steps

1. On a Windows PC: unzip portable → `Install.bat` → edit `.env.cmd` → `Start-OpenBot.bat`
2. Point Aria `COMPUTER_SUPERVISOR_URL` at that host for local headed Take control
3. Merge PR #77 into campaign branch / continue Fly LinkedIn login proof on PR #76

## Decisions made (don't relitigate)

- Production LinkedIn/OpenBot/campaign VMs = Fly only
- Windows package = local headed workstation path, not a replacement for Fly prod
- Zip does not embed `node_modules` — Windows runs `Install.bat` (Node 20+)
- Never `COMPUTER_SUPERVISOR_MOCK_SEND=1` on prod

## Watch out

- Do not commit computer/supervisor tokens or `.env.cmd`
- Built zip under `dist/` is gitignored — regenerate with pack script
