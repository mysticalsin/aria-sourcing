---
project: MSourcing / ARIA
shift: 184
agent: cursor-cloud
updated: 2026-09-12T00:30Z
status: seat-attributed-source-reply-allocate-tip-not-released
---

# Handoff — Shift 184

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` @ `9f5f333` (source/reply/allocate floor FX carry real seatId; sole-LI / latest-outreach helpers; per-desk allocate pulses)
- **Fly:** https://aria-mantu-app.fly.dev — tip **not live**; `/api/ready` `8ea3370…` / `ok:false`
- **Live fleet (demo-login):** 1 computer `comp_7fe31958-…` seat `600e8afa-…` `sessionHealthy:false` `control:bot` (honest)
- **PR:** tip pushed; recreate when write tool available (prior #134 CLOSED)

## Done this shift

1. `soleCampaignBrowserSeatId` — campaign source FX only when exactly one LI Browser Computer seat owns the campaign
2. `latestOutreachSeatId` — reply FX attributes to last outreach desk
3. Fleet allocate emits **one pulse per drafting seat** (no collapse onto first seatId)
4. Helpers in `src/lib/agent-event-seat.ts` + tests `agent-event-seat` 5/5
5. Prior tip: PacketFX seatId-only; ensure refuses live/human retarget; confirmManual N-seat fail-closed; orphan summary excluded

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
- Floor pulse + PacketFX require `seatId`; multi-LI campaigns omit source seatId (no hash)
- Allocate pulses each drafting desk
- Fly-only LinkedIn / OpenBot / computers
- **Do not bypass protected Fly release guards**

## Watch out

- Demo-login `username` field; ~5/min; `Twalteur@amaris.com`
- Closing PRs often deletes remote branch
- Large mp4s stay in `/opt/cursor/artifacts/`
