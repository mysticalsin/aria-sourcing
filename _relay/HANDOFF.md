---
project: MSourcing / ARIA
shift: 192
agent: cursor-cloud
updated: 2026-09-12T05:00Z
status: ai-e2e-landing-calendar-fixes-shipped-tip-not-released
---

# Handoff — Shift 192

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` — AI e2e landing / humanizer / Teams calendar fixes on top of Settings plug-and-play
- **Fly:** https://aria-mantu-app.fly.dev — tip **not live**; `/api/ready` still stale / `ok:false`
- **Live fleet:** human LinkedIn login / `sessionHealthy` still outstanding — no invented Tony Connect delivery
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/138 (draft #138)
- **Audit:** `_relay/evidence/2026-09-12-ai-e2e-deep-audit.md`
- **Walkthrough:** `/opt/cursor/artifacts/2026-09-12-tony-walteur-ai-e2e-walkthrough.mp4` + `_relay/evidence/2026-09-12-tony-ai-e2e/`

## Done this shift

1. Deep audit: needs → source → humanize → approve/gate → AriaBot Connect/Message → INTERESTED → Teams on HM Outlook
2. Shared `src/lib/linkedin-invite-note.ts` (`LINKEDIN_INVITE_NOTE_MAX=200`, `fitLinkedInInviteNote`, draft rules)
3. Hermes / TASK_SYSTEM Connect-first ≤200; mock LinkedIn invite via fit helper
4. OpenBot: body-only free DM; fail-closed when note ≫200 (no robotic mid-sentence slice into Send)
5. Approve API: `gateOutbound` + LinkedIn ≤200 enforce
6. Follow-up / generate / regen: inject LinkedIn guardrail + 200-char reminder
7. Vendor LinkedIn channel: humanize before post
8. Graph calendar: `isOnlineMeeting` + Teams provider; prefer `joinUrl`
9. Booking: prefer `campaign.hiringManagerEmail` when rostered
10. Skills + humanizer: empathic Connect guidance + lexicon
11. Tony walkthrough video recorded (honest: tip stale; no fake land proof)
12. Focused tests green: typecheck, typecheck:tests, linkedin-connections 52, linkedin-send-contract 9, humanizer 41, gate 105, outreach-guardrails 42

## Blockers (goal incomplete)

1. Tip not on protected Fly release
2. Human Take control + LinkedIn login/2FA (`sessionHealthy` still false)
3. Host cap / agent frameworks readiness on Fly
4. Operator N-seat prove of tip features outstanding on live
5. Graph free-busy against HM calendar (local busy only) — next
6. Auto-attach Browser Computer on campaign create — still manual Attach
7. INTERESTED does not auto-book Teams yet

## Next steps

1. Land tip via protected release — `/api/ready` build SHA == tip
2. Human Take control → LinkedIn login/2FA → Release → session probe healthy
3. Prove real Tony Walteur Connect land (My Network → Invitations) with ≤200 note + UI proof
4. Prove N distinct computerIds, no cross-desk bleed, floor pulses each LI desk on source
5. Graph free-busy + auto-book INTERESTED on HM Outlook/Teams
6. Mark PR ready only with tip live + healthy session + N-seat + land evidence

## Decisions (don't relitigate)

- Never invent `sessionHealthy=true` / LinkedIn delivered without probe + UI proof
- Invite notes ≤ **200**; Message/Invite both fail-closed on disabled Send / missing proof
- Orphan VMs must not green-badge, inflate fleet/campaign counts, or ops-drive other seats
- PATCH / ensure must not steal or silently retarget another seat's live/ready computerId
- Human `control` ⇒ floor idle; unbound computerId ⇒ fail-closed health
- Floor pulse + PacketFX require `seatId`; multi-LI **source** pulses each attached desk; drafts/send stay sole/msg.seatId fail-closed
- Ambiguous N-seat send/approve ⇒ fail-closed
- Settings Automatic Ready tracks AriaBot supervisor + Browser seat (not OIDC/HeyReach alone)
- Primary Settings CTA is Open LinkedIn login for agents; delivery/HeyReach/OIDC under Advanced
- Manual LinkedIn confirm counts toward seat `sentToday`; Browser Computer uses automatic send not paste-confirm
- Simulate inbound must name a LinkedIn seat (never seats[0] lottery)
- Fly-only LinkedIn / OpenBot / computers
- **Do not bypass protected Fly release guards**
- Connect invite surfaces under My Network → Invitations, not Messaging
- Graph interview events create Teams online meetings; pin HM when `hiringManagerEmail` rostered

## Watch out

- Demo-login `username` field; ~5/min; `Twalteur@amaris.com`
- Closing PRs often deletes remote branch
- Large mp4s stay in `/opt/cursor/artifacts/`
- `allocateBatch` + `enforceBusinessHours` fails on weekends unless tests pass weekday `now`
- LinkedIn connections contract looks for `/never your password/i` and Sign in with LinkedIn
- Tip UI on live may lag Settings plug-and-play until protected release
