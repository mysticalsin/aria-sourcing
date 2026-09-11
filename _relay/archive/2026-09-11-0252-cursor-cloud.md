---
project: MSourcing / ARIA
shift: 145
agent: cursor-cloud
updated: 2026-09-11T02:35Z
status: e2e-tangibility-wired
---

# Handoff — Shift 145

## Current state

- **Branch:** `cursor/openbot-desktop-vm-b91d` (ready to push)
- **Fly:** `aria-mantu-computers` — `OPENBOT_MAX_COMPUTERS=5` (host VM cap ≠ fleet `maxAgents`)
- **E2E wiring:** Deploy → LinkedIn Browser Computer seats with `computerId` → Fleet ensure VMs → Floor 3D overlays live computer status; pulses prefer `event.seatId`
- **Audit:** `_relay/e2e-tangibility-audit.md`

## Done this shift

1. Persist `computerId` / LinkedIn delivery backend / `assignedCampaignIds` on fleet seat create
2. Floor `agentActivity` prefers `assignedCampaignIds`; 3D `pickResponderIndex` prefers `seatId`
3. Outreach allocate prefers campaign-attached seats; allocate/send emit `seatId` when known
4. `deployAgents` creates real LinkedIn Browser Computer seats (demo + live); Fleet default deploy = 5; toast mentions host VM cap
5. Floor polls `/api/fleet/computers` and overlays `help_requested` / busy / starting / unhealthy onto office agents
6. `tests/floor.mts` green; `tsc --noEmit` green; fixed broken `tests/test-manifest.mjs` entry

## Blockers

1. Human Take control + LinkedIn/Recruiter login (2FA/captcha) per seat
2. Host VM cap (Fly=5) must be raised (or multi-host) before “16 agents on the map with 16 VMs” is literally true

## Next steps

1. Operator: deploy ≤ host cap → Take control login each seat → assign to campaign → verify `/floor` shows N agents + VM status
2. Optional: raise `OPENBOT_MAX_COMPUTERS` on Fly; stamp connected account after healthy probe
3. Optional: emit `seatId` on source events when a Browser Computer seat ran the search

## Decisions (don't relitigate)

- N seats = N Chromium profiles / VMs
- Recruiter via Take control (no auto InMail)
- Take control primary = real desktop (noVNC)
- Floor tangibility = assigned campaigns + live computer status + seatId pulses (not theatre-only)

## Watch out

- Never commit Fly `SUPERVISOR_TOKEN` / `COMPUTER_TOKEN` / demo passwords
- Fleet `maxAgents` can exceed host VM cap — surface ensure failures; don't pretend 300 VMs on one host
- tint2 v17 keys only; Playwright forbids `deviceScaleFactor` with `viewport: null`
