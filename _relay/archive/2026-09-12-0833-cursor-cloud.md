---
project: MSourcing / ARIA
shift: 196
agent: cursor-cloud
updated: 2026-09-12T08:14Z
status: linkedin-ui-second-brain-shipped-marketing-video-honest-gate
---

# Handoff — Shift 196

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` — LinkedIn UI second-brain lessons + prior N-seat ownership gates + sealed outreach
- **Fly:** tip **not live**; `/api/ready` stale; fleet computer `sessionHealthy:false` (LinkedIn checkpoint wall)
- **Marketing video:** `/opt/cursor/artifacts/2026-09-12-aria-marketing-n-agent-linkedin-e2e.mp4` (+ highlights) — honest gate, **does not claim LinkedIn Sent**
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/141

## Done this shift

1. `linkedin-ui-lessons` store under `data/llm-wiki` (JSON + markdown second brain)
2. OpenBot `linkedin-send` injects lesson hints into LLM picks; appends win/fail lessons; preferConnect from path memory
3. Computer supervisor passes `seatId`/`campaignId` into send for per-desk lessons
4. Skills page shows **LinkedIn UI lessons** card; API `GET/POST /api/knowledge/linkedin-ui-lessons`
5. Marketing recorder + E2E video (floor → campaign → outreach → skills → fleet Take control → honest LinkedIn gate)
6. Tests: linkedin-ui-lessons 9; typecheck green

## Blockers (goal incomplete)

1. Tip not on protected Fly release
2. Human Take control + LinkedIn login/2FA (`sessionHealthy` still false) — **blocks seeing messages in LinkedIn**
3. Host cap / DeerFlow+Flowise readiness
4. Live N-seat prove + sealed Tony land with UI proof

## Next steps

1. Land tip via protected release
2. Operator Take control on unhealthy computer → LinkedIn login/2FA → Release → probe healthy
3. Re-run marketing recorder; claim LinkedIn land only with Sent/Pending UI proof
4. Prove N distinct computerIds + floor pulses

## Decisions (don't relitigate)

- Never invent `sessionHealthy=true` / LinkedIn delivered without probe + UI proof
- Copy lessons (`outreach_skill`) stay separate from VM UI lessons (`linkedin-ui-lessons`)
- Sealed outreach copy is the only text bots type/post
- Orphan VMs must not green-badge or ops-drive other seats
- **Do not bypass protected Fly release guards**

## Watch out

- Demo-login `username` = `Twalteur@amaris.com`; ~5/min
- Large mp4s live in `/opt/cursor/artifacts/` (full marketing E2E ~4.8MB)
