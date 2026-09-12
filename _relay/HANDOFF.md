---
project: MSourcing / ARIA
shift: 190
agent: cursor-cloud
updated: 2026-09-12T04:20Z
status: approve-confirm-simulate-packet-hub-tip-not-released
---

# Handoff — Shift 190

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` @ `ad805c4` — approve/confirm fail-closed + simulate seat + PacketFX LI hub
- **Fly:** https://aria-mantu-app.fly.dev — tip **not live**; `/api/ready` build `8ea3370…` / `ok:false`
- **Live fleet:** still 1 computer, `sessionHealthy:false` (honest) — human LinkedIn login outstanding
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/137 (draft #137)

## Done this shift

1. Approve: empty LinkedIn `seatId` stamps sole automatic seat (Browser or Vendor); fail-closed when 0 or N>1
2. Manual confirm: RPC allowlist only (Assisted Manual / Vendor API); Browser Computer refused with clear Send-Approved guidance
3. Settings Simulate: seat picker (no `seats[0]` attribution theater)
4. Browser Computer list: healthy / unhealthy / unverified session badges
5. PacketFX hub: prefer bound LinkedIn Browser Computer over roster[0] email theater
6. Tania feed: removed seatless `source` bus ping (store already pulses LI desks)
7. Tests: agent-event-seat 6/6; floor 65/65; linkedin-connections 47/47; typecheck green

## Blockers (goal incomplete)

1. Tip not on protected Fly release
2. Human Take control + LinkedIn login/2FA (`sessionHealthy` still false)
3. `OPENBOT_MAX_COMPUTERS=5`; agent frameworks not ready on Fly
4. Operator N-seat prove of tip features outstanding on live

## Next steps

1. Human Take control → LinkedIn login/2FA → Release → session probe healthy
2. Land tip via protected release — `/api/ready` build SHA == tip
3. Prove N distinct computerIds, no cross-desk bleed, floor pulses each LI desk on source
4. Mark PR ready only with tip live + healthy session + N-seat evidence

## Decisions (don't relitigate)

- Never invent `sessionHealthy=true` / LinkedIn delivered without probe + UI proof
- Invite notes ≤ **200**; Message/Invite both fail-closed on disabled Send / missing proof
- Orphan VMs must not green-badge, inflate fleet/campaign counts, or ops-drive other seats
- PATCH / ensure must not steal or silently retarget another seat's live/ready computerId
- Human `control` ⇒ floor idle; unbound computerId ⇒ fail-closed health
- Floor pulse + PacketFX require `seatId`; multi-LI **source** pulses each attached desk; drafts/send stay sole/msg.seatId fail-closed
- Allocate pulses each drafting desk
- Ambiguous N-seat send/approve ⇒ fail-closed (LI/WA/SMS/Email)
- ready-unverified VMs refuse client retarget (boot race)
- Cortex narrates VM-truth when computerHints present; campaign pick uses `assignedCampaignIds`
- Follow-up / vivier / generate LI drafts sole-stamp when seatId omitted
- Manual LinkedIn confirm counts toward seat `sentToday`; Browser Computer uses automatic send not paste-confirm
- Simulate inbound must name a LinkedIn seat (never seats[0] lottery)
- PacketFX hub prefers LI Browser Computer over email roster[0]
- Seatless replay/source FX omit desk paint when no attached LI seats
- Fly-only LinkedIn / OpenBot / computers
- **Do not bypass protected Fly release guards**

## Watch out

- Demo-login `username` field; ~5/min; `Twalteur@amaris.com`
- Closing PRs often deletes remote branch
- Large mp4s stay in `/opt/cursor/artifacts/`
- `allocateBatch` + `enforceBusinessHours` fails on weekends unless tests pass weekday `now`
