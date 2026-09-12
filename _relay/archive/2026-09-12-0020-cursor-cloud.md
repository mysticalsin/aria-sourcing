---
project: MSourcing / ARIA
shift: 183
agent: cursor-cloud
updated: 2026-09-11T23:50Z
status: packet-ensure-confirm-orphan-summary-tip-not-released
---

# Handoff — Shift 183

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` @ `5b5493a` (PacketFX seatId-only; ensure refuses live/human retarget; confirmManual requires seatId for N LI; fleet summary excludes orphans)
- **Fly:** https://aria-mantu-app.fly.dev — tip **not live**; `/api/ready` build `8ea3370…` / `ok:false`
- **Live fleet:** 1 computer, `sessionHealthy:false` until human LinkedIn login
- **PR:** tip pushed; recreate when write tool available (prior #134 CLOSED)

## Done this shift

1. PacketFX drops seatless events (no hash-paint LI desks)
2. `ensureComputer` refuses retarget when `sessionHealthy===true` or `control===human` (stopped→stable DB id still allowed)
3. Fleet ops summary excludes `__orphan__` rows (list still shows them for Login reclaim)
4. `confirmManualSend` requires `msg.seatId` when N LinkedIn seats exist; never first-seat bleed
5. Tests: computer-supervisor 74; computer-audit 21; floor 62; fleet-hermes-sync 10; typecheck green
6. Prior: fail-closed unbound health; campaign seat-owned-only; floor pulse seatId; takeControl clears healthy; dead AgentModel removed

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
- Orphan VMs must not green-badge, inflate fleet/campaign counts, or ops-drive other seats
- PATCH / ensure must not steal or silently retarget another seat's live computerId
- Human `control` ⇒ floor idle; unbound computerId ⇒ fail-closed health
- Floor pulse + PacketFX require `seatId` (no theatrical hash onto LI desks)
- Fly-only LinkedIn / OpenBot / computers
- **Do not bypass protected Fly release guards**

## Watch out

- Demo-login `username` field; ~5/min; `Twalteur@amaris.com`
- Closing PRs often deletes remote branch
- Large mp4s stay in `/opt/cursor/artifacts/`
