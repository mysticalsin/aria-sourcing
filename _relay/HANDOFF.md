---
project: MSourcing / ARIA
shift: 191
agent: cursor-cloud
updated: 2026-09-12T04:37Z
status: settings-plug-and-play-shipped-tip-not-released
---

# Handoff — Shift 191

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` (Settings plug-and-play UX; commit pending/push this shift)
- **Fly:** https://aria-mantu-app.fly.dev — tip **not live**; `/api/ready` still stale / `ok:false`
- **Live fleet:** human LinkedIn login / `sessionHealthy` still outstanding
- **PR:** recreate/update via ManagePullRequest (prior drafts often closed + branch deleted)

## Done this shift

1. LinkedIn outreach stack: **2-step Ready** = supervisor + Browser Computer seat (not OIDC/HeyReach theater)
2. Delivery mode + HeyReach moved under **Advanced**
3. Identity: single primary CTA **Open LinkedIn login for agents**; Recruiter / seat-only / add-another under More seat options
4. SystemReadiness: required first; optional checks collapsed
5. Setup guide: Connect AriaBot step + take-control CTA → `#linkedin-outreach-stack`; done from `computerId`
6. Get started + credentials copy name AriaBot Browser Computer / Open LinkedIn login for agents
7. Tests: linkedin-connections **52/52**; `typecheck` + `typecheck:tests` green

## Blockers (goal incomplete)

1. Tip not on protected Fly release
2. Human Take control + LinkedIn login/2FA (`sessionHealthy` still false)
3. Host cap / agent frameworks readiness on Fly
4. Operator N-seat prove of tip features outstanding on live

## Next steps

1. Land tip via protected release — `/api/ready` build SHA == tip
2. Human Take control → LinkedIn login/2FA → Release → session probe healthy
3. Prove N distinct computerIds, no cross-desk bleed, floor pulses each LI desk on source
4. Mark PR ready only with tip live + healthy session + N-seat evidence

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

## Watch out

- Demo-login `username` field; ~5/min; `Twalteur@amaris.com`
- Closing PRs often deletes remote branch
- Large mp4s stay in `/opt/cursor/artifacts/`
- `allocateBatch` + `enforceBusinessHours` fails on weekends unless tests pass weekday `now`
- LinkedIn connections contract looks for `/never your password/i` and Sign in with LinkedIn
