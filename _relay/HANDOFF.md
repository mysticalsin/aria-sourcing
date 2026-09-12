---
project: MSourcing / ARIA
shift: 187
agent: cursor-cloud
updated: 2026-09-12T02:20Z
status: orphan-ops-cortex-approve-fail-closed-tip-not-released
---

# Handoff — Shift 187

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` @ `0e73d8b` (orphan fleet ops + cortex VM-truth + LI approve/draft seatId)
- **Fly:** https://aria-mantu-app.fly.dev — tip **not live**; `/api/ready` `8ea3370…` / `ok:false`
- **Live fleet:** still 1 computer, `sessionHealthy:false` (honest) — human LinkedIn login outstanding
- **PR:** tip push next; recreate when write tool available (prior #134 CLOSED)

## Done this shift

1. Fleet Computers: `__orphan__` VMs are reclaim-only — no Start/Take; session badge not green-as-owned
2. Fleet page `computerAction` refuses start/take_control on unbound rows (toast)
3. Cortex uses `agentActivityWithComputers` when floor passes live computerHints
4. LinkedIn draft stamps `soleCampaignBrowserSeatId` when caller omits seatId
5. Approve fail-closed: N automatic LI seats + empty `msg.seatId` refused (sole seat auto-stamped)
6. Prior tip: ready-retarget refuse, navigate/probe ensured id, floor/send fail-closed, dead floor3d deleted
7. Tests: floor 63/63; computer-supervisor 75/75; sourcing-automatic-deliver 12/12; agent-event-seat 5/5; typecheck green

## Blockers (goal incomplete)

1. Tip not on protected Fly release
2. Human Take control + LinkedIn login/2FA (`sessionHealthy` still false)
3. OPENBOT_MAX_COMPUTERS=5; agentFrameworks:false
4. Operator N-seat prove of tip features outstanding on live
5. PR recreate when write tool available

## Next steps

1. Human Take control → LinkedIn login/2FA → Release → session_probe healthy
2. Land tip via protected release — `/api/ready` build SHA == tip
3. Prove N distinct computerIds, no cross-desk bleed, floor only healthy/real-send / seatId pulses
4. Mark PR ready only with tip live + healthy session + N-seat evidence

## Decisions (don't relitigate)

- Never invent `sessionHealthy=true` / LinkedIn delivered without probe + UI proof
- Invite notes ≤ **200**; Message/Invite both fail-closed on disabled Send / missing proof
- Orphan VMs must not green-badge, inflate fleet/campaign counts, or ops-drive other seats
- PATCH / ensure must not steal or silently retarget another seat's live/ready computerId
- Human `control` ⇒ floor idle; unbound computerId ⇒ fail-closed health
- Floor pulse + PacketFX require `seatId`; multi-LI campaigns omit source seatId (no hash)
- Allocate pulses each drafting desk
- Ambiguous N-seat send/approve ⇒ fail-closed (LI/WA/SMS/Email)
- ready-unverified VMs refuse client retarget (boot race)
- Cortex narrates VM-truth when computerHints present (no theatrical busy for unhealthy LI)
- Seatless replay/source FX omit desk paint (no hash bleed)
- Fly-only LinkedIn / OpenBot / computers
- **Do not bypass protected Fly release guards**

## Watch out

- Demo-login `username` field; ~5/min; `Twalteur@amaris.com`
- Closing PRs often deletes remote branch
- Large mp4s stay in `/opt/cursor/artifacts/`
- `allocateBatch` + `enforceBusinessHours` fails on weekends unless tests pass weekday `now`
