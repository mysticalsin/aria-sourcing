---
project: MSourcing / ARIA
shift: 189
agent: cursor-cloud
updated: 2026-09-12T03:25Z
status: reclaim-deploy-ux-n-source-pulses-tip-not-released
---

# Handoff — Shift 189

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` @ `6459ee2` — reclaim/Deploy UX + N-seat source pulses
- **Fly:** https://aria-mantu-app.fly.dev — tip **not live**; `/api/ready` build `8ea3370…` / `ok:false`
- **Live fleet:** still 1 computer, `sessionHealthy:false` (honest) — human LinkedIn login outstanding
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/136 (draft #136)

## Done this shift

1. Fleet Computers: unbound VMs get **Reclaim onto seat** (seat picker → `reclaim_healthy_orphan` + seat `computerId` bind)
2. Campaign Agents: seats with no VM get **Deploy computer** (`resolveDurableComputerId` → `updateSeat` → `bootBrowserComputer`)
3. Floor pulse + activity ticker resolve by `seatId` across full roster (desk 0 no longer invisible)
4. Source waves pulse **every** attached LI Browser desk via `campaignBrowserSeatIds` (allocate-style; sole stamp still fail-closed for drafts)
5. Ban-risk strip: per-desk `help_requested` matched by `computerId` (no global seats[0] bleed)
6. Tests: agent-event-seat 6/6; floor 65/65; typecheck green

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
- Manual LinkedIn confirm counts toward seat `sentToday`
- Seatless replay/source FX omit desk paint when no attached LI seats
- Fly-only LinkedIn / OpenBot / computers
- **Do not bypass protected Fly release guards**

## Watch out

- Demo-login `username` field; ~5/min; `Twalteur@amaris.com`
- Closing PRs often deletes remote branch
- Large mp4s stay in `/opt/cursor/artifacts/`
- `allocateBatch` + `enforceBusinessHours` fails on weekends unless tests pass weekday `now`
