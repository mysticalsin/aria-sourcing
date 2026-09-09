---
project: MSourcing / ARIA
shift: 119
agent: cursor-cloud
updated: 2026-09-09T07:55Z
status: linkedin-campaign-reachout-wired
---

# Handoff — Shift 119

## Current state

- **Branch:** `cursor/campaign-agent-vm-control-b91d`
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/76
- **Fly web:** https://aria-mantu-app.fly.dev
- **Fly Chromium:** https://aria-mantu-computers.fly.dev
- **LinkedIn reach-out:** campaign-scoped seat pick + `campaignId` on browser-computer `linkedin_send` + dispatcher outbox `campaign_id`
- **Proofs:** mock `sent` + Fly Chromium `linkedin_send` → login/2FA wall (Take control) — both campaign-tagged

## Done this shift

1. `pickLiveLinkedInSendSeat` prefers Browser Computers attached to the campaign
2. `LinkedInDeliveryRequest.campaignId` → ensure/start/enqueueJob payload + audits
3. `dispatch-outbound` selects `campaign_id` and passes it into adapter.deliver
4. Tests: linkedin-channel-contract, sourcing-automatic-deliver, computer-supervisor
5. `scripts/prove-linkedin-campaign-reachout.mjs` against mock + Fly computers

## Blockers

1. Apply migration `0082` on Fly Supabase before tenant Attach survives hydrate
2. Redeploy `aria-mantu-app` tip so polish + LinkedIn campaign wiring ship together
3. LinkedIn session still needs human Take control once (login/2FA) before auto-send succeeds on Fly Chromium

## Next steps

1. Apply `0082` on Fly DB / protected deploy ledger
2. Redeploy app image with this branch
3. Operator: Campaign Agents → Observe / Take control → complete LinkedIn login once per seat
4. Re-run `scripts/prove-linkedin-campaign-reachout.mjs` against Fly — expect `sent` after login

## Decisions made (don't relitigate)

- Production LinkedIn/OpenBot/campaign VMs = Fly only (never Vercel)
- 1 seat = 1 Chromium; Campaign Agents shares Fleet mutex
- Never `COMPUTER_SUPERVISOR_MOCK_SEND=1` on prod
- Soft seat preference: campaign-attached first, then unscoped, then other-campaign seats
- Wiki recall ≠ contact lease

## Watch out

- Do not commit supervisor/computer tokens
- Until `0082` is applied, SELECT including `assigned_campaign_ids` fails against old DBs
- Real LinkedIn send on Fly requires a logged-in Chromium profile (Take control once)
