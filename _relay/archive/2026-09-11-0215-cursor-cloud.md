---
project: MSourcing / ARIA
shift: 143
agent: cursor-cloud
updated: 2026-09-11T01:16Z
status: openbot-desktop-vm-deployed
---

# Handoff — Shift 143

## Current state

- **Branch:** `cursor/openbot-desktop-vm-b91d`
- **Fly:** `aria-mantu-computers` healthy with `desktop:true`, `liveView:"desktop-vm"`, stream `x11vnc+novnc`
- **Take control URL:** `/desktop/:botId` (noVNC of real headed Chrome + OS taskbar). CDP `/view/:botId` remains as page-only fallback.

## Done this shift

1. Per-seat virtual desktop: Xvfb + openbox + tint2 dock + x11vnc + websockify/noVNC
2. Headed Chromium maximized on that display (real tabs + omnibox) — Métis Operator style
3. `viewUrl` points to desktop stream when `OPENBOT_DESKTOP=1`
4. Dockerfile.computers installs desktop stack; fly.computers.toml enables headed+desktop
5. Local proof screenshot: `/opt/cursor/artifacts/desktop-vm-metis-style.png`

## Blockers

1. Operator should Take control again — mouse maps 1:1 via noVNC to the real desktop; finish LinkedIn login/captcha
2. Existing seats may need re-ensure after deploy to pick up a desktop display

## Next steps

1. Operator: Take control on a seat → confirm Chrome tabs + bottom dock visible → login
2. Open/refresh PR for this branch vs `integration/sourcing-enrichment-on-main`
3. Re-run Tony Walteur Connect E2E after session persists

## Decisions (don't relitigate)

- Take control primary surface = real desktop (noVNC), not CDP page screencast
- Connect/Message stays AriaBot Take control only
- Never invent LinkedIn profile URLs

## Watch out

- Dockerfile must COPY `scripts/lib/openbot-desktop-seat.mjs` + `scripts/desktop/`
- Playwright forbids `deviceScaleFactor` with `viewport: null` (desktop chrome UI mode)
- tint2 v17 uses `time1_format` / `task_maximum_size` (not obsolete `clock_format` / `task_icon_size`)
- Never commit Fly secrets / demo passwords / Tavily keys
