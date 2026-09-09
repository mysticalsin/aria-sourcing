---
project: MSourcing / ARIA
shift: 118
agent: cursor-cloud
updated: 2026-09-09T07:45Z
status: campaign-agents-e2e-polish-green
---

# Handoff — Shift 118

## Current state

- **Branch:** `cursor/campaign-agent-vm-control-b91d`
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/76
- **Fly web:** https://aria-mantu-app.fly.dev
- **Fly Chromium:** https://aria-mantu-computers.fly.dev
- **Polish:** Campaign Agents UX + DB campaign↔seat + campaign/job audits
- **Migration:** `0082_campaign_agent_bindings.sql` (apply on Fly Supabase before tenant attach persists)
- **E2E:** `scripts/record-campaign-agents-vm-e2e.mjs` green (Observe boots → Take control → Release + takeover audit)

## Done this shift

1. Observe starts VM if needed; error status no longer fakes success; toasts + human coaching
2. Detach confirms when live/human; labels “attached/live”; audits show time + correlation
3. `assigned_campaign_ids` on `agent_seats` + PATCH/store persistence for Fly tenants
4. `computer_audits.campaign_id`; POST/GET computers accept `campaignId`; jobId + `act_failed` trails
5. Supervisor + fleet-seats-assign tests green; local E2E recorder green

## Blockers

1. Apply migration `0082` on Fly Supabase before production Attach survives hydrate
2. Redeploy `aria-mantu-app` after merge for polish UI on Fly tip
3. Deferred: Chromium profile volume on computers app; full per-candidate campaign work feed

## Next steps

1. Apply `0082` on Fly DB / protected deploy ledger
2. Redeploy app image with this branch
3. Optional: persistent `/data` volume on `aria-mantu-computers`

## Decisions made (don't relitigate)

- Production LinkedIn/OpenBot/campaign VMs = Fly only (never Vercel)
- 1 seat = 1 Chromium; Campaign Agents shares Fleet mutex
- Never `COMPUTER_SUPERVISOR_MOCK_SEND=1` on prod
- Wiki recall ≠ contact lease

## Watch out

- Do not commit supervisor/computer tokens
- Until `0082` is applied, SELECT including `assigned_campaign_ids` will fail against old DBs — deploy migration with the app
- Vercel is out of scope for this path
