---
project: MSourcing / ARIA
shift: 182
agent: cursor-cloud
updated: 2026-09-11T23:15Z
status: isolation-honesty-pulse-orphan-failclosed-tip-not-released
---

# Handoff — Shift 182

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` @ `562ad28` (fail-closed unbound health; campaign seat-owned-only; floor pulse requires seatId; dead AgentModel/RobotAgent/packet-shared removed)
- **Fly:** https://aria-mantu-app.fly.dev — tip **not live**; `/api/ready` build `8ea3370…` / `ok:false`
- **Live fleet:** 1 computer, `sessionHealthy:false` until human LinkedIn login
- **PR:** tip pushed; recreate when write tool available (prior #134 CLOSED)

## Done this shift

1. `computerHealthOwnedBySeat` fail-closed when computerId absent from fleet (no stale green)
2. Campaign Agents ingest **seat-owned rows only** (orphans out of badges/ops)
3. Floor desk pulse + activity attribution require `event.seatId` (no hash-paint LI VMs)
4. Approve outreach emit carries `msg.seatId` when present
5. Deleted unused theatrical `AgentModel.tsx` / `RobotAgent.tsx` / `packet-shared.ts` (~1.2k LOC)
6. Tests: fleet-hermes-sync 10, floor 62, computer-supervisor 71; typecheck green
7. Prior tip: takeControl clears healthy; floor honors control=human; sticky 1.5s; prefer base36

## Blockers (goal incomplete)

1. Tip not on protected Fly release
2. Human Take control + LinkedIn login/2FA (`sessionHealthy` still false)
3. OPENBOT_MAX_COMPUTERS=5; agentFrameworks:false
4. Operator N-seat prove of tip features outstanding on live
5. PR recreate (ManagePullRequest/gh write unavailable)

## Next steps

1. Human Take control → LinkedIn login/2FA → Release → session_probe healthy
2. Land tip via protected release — `/api/ready` build SHA == tip
3. Prove N distinct computerIds, no cross-desk bleed, floor only healthy/real-send / seatId pulses
4. Mark PR ready only with tip live + healthy session + N-seat evidence

## Decisions (don't relitigate)

- Never invent `sessionHealthy=true` / LinkedIn delivered without probe + UI proof
- Invite notes ≤ **200**; Message/Invite both fail-closed on disabled Send / missing proof
- Orphan VMs must not green-badge, inflate campaign counts, or ops-drive other seats
- PATCH must not steal another seat's computerId
- Human `control` ⇒ floor idle; unbound computerId ⇒ fail-closed health
- Floor pulse requires `seatId` (no theatrical hash onto LI desks)
- Fly-only LinkedIn / OpenBot / computers
- **Do not bypass protected Fly release guards**

## Watch out

- Demo-login `username` field; ~5/min; `Twalteur@amaris.com`
- Closing PRs often deletes remote branch
- Large mp4s stay in `/opt/cursor/artifacts/`
