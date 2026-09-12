---
project: MSourcing / ARIA
shift: 188
agent: cursor-cloud
updated: 2026-09-12T03:04Z
status: followup-cortex-orphan-api-manual-counters-tip-not-released
---

# Handoff — Shift 188

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` @ `c7de0ca` + docs `4c3cd55`
- **Fly:** https://aria-mantu-app.fly.dev — tip **not live**; `/api/ready` build `8ea3370…` / `ok:false`
- **Live fleet:** still 1 computer, `sessionHealthy:false` (honest) — human LinkedIn login outstanding
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/135 (draft)

## Done this shift

1. `draftFollowUpFor` / `draftRecontactFor`: sole LinkedIn Browser seat stamped via `soleCampaignBrowserSeatId` when channel is LinkedIn and caller omits `seatId` (same as `generateOutreachLive`)
2. `generateOutreachLive` sole-seat stamp included (was dirty working tree)
3. `agentCortexTrace` campaign pick uses `assignedCampaignIds` pool (mirrors `agentActivity` in `floor.ts` — no fleet-wide hash bleed)
4. POST `/api/fleet/computers` `start` / `take_control` refuse unbound / `HOST_ORPHAN_SEAT_ID` (`__orphan__`) with 400 — matches FE reclaim-only
5. `confirmManualSend` bumps `seat.sentToday` / `lastSendAt` like live send
6. `BanRiskStrip` lists every campaign seat (no `seats[0]` theater)
7. Tests: floor 65/65 (+cortex assigned); agent-event-seat 5/5; computer-supervisor 75/75; typecheck + typecheck:tests green

## Blockers (goal incomplete)

1. Tip not on protected Fly release
2. Human Take control + LinkedIn login/2FA (`sessionHealthy` still false)
3. `OPENBOT_MAX_COMPUTERS=5`; agent frameworks not ready on Fly
4. Operator N-seat prove of tip features outstanding on live

## Next steps

1. Human Take control → LinkedIn login/2FA → Release → session probe healthy
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
- Cortex narrates VM-truth when computerHints present; campaign pick uses `assignedCampaignIds`
- Follow-up / vivier / generate LI drafts sole-stamp when seatId omitted
- Manual LinkedIn confirm counts toward seat `sentToday`
- Seatless replay/source FX omit desk paint (no hash bleed)
- Fly-only LinkedIn / OpenBot / computers
- **Do not bypass protected Fly release guards**

## Watch out

- Demo-login `username` field; ~5/min; `Twalteur@amaris.com`
- Closing PRs often deletes remote branch
- Large mp4s stay in `/opt/cursor/artifacts/`
- `allocateBatch` + `enforceBusinessHours` fails on weekends unless tests pass weekday `now`
