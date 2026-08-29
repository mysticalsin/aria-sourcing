---
project: MSourcing / ARIA
shift: 415
agent: cursor-cloud
updated: 2026-08-29T22:45Z
status: tip-ready-ops-partial-graph-hold
---

# Handoff — Shift 415

## Current state

- **Branch / PR:** `cursor/rei-autopilot-send-b91d` → **PR #40** (git tip may be relay-ahead of live image)
- **Live Fly image:** `b0cf56a` — `/api/ready` **ok:true**, migration **0079**, `components.migration:true`
- **Bootstrap:** 0077 DROP-before-recreate fixed; **0076–0079** applied (`[migrate] complete`)
- **Ops wired this shift:**
  - Admin `autopilot_enabled=true` (user `521a53af-…`)
  - `set_sourcing_loop_controls` → kill off, intake/sourcing/sequences **on**
  - Fly secret `ARIA_LOOP_WORKSPACE_IDS=0d179005-e8e2-4b99-8b9a-b67453348005` **Deployed** (verified on loop machine)
- **Seats:** 6× Microsoft Graph (`domain_verified=false`, Graph secrets absent) + 1× LinkedIn Assisted Manual — **no HeyReach seat**
- **Dropzones:** Microsoft/Azure/LLM owner files **absent** → Graph = **HOLD**
- **Autopilot E2E:** still **unproven** (no live mailbox / no HeyReach seat / no inbound→auto-send receipt)

## Done this shift

1. Fixed `0077_heyreach_inbound_route.sql` DROP FUNCTION; redeployed; ready green
2. Entitled admin Autopilot + armed Sequences via admin JWT RPCs
3. Set `ARIA_LOOP_WORKSPACE_IDS` on Fly
4. STATUS.md + HANDOFF updated; PR #40 body refreshed

## Blockers

1. Graph dropzones empty → cannot heal Graph mailbox / live Teams book (HOLD)
2. No HeyReach seat + Settings campaign — LI Autopilot cannot send
3. Graph seats `domain_verified=false` without live Graph → email Autopilot fail-closed
4. Full Autopilot E2E receipt still required

## Next steps

```bash
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
ls /tmp/owner-azure-app-id /tmp/owner-microsoft.env /tmp/owner-llm.env
# missing → Graph HOLD; do not chase Entra
# Owner: Settings → HeyReach seat + Save API/campaign; or drop Graph secrets for email path
# Prove: inbound → critics-green draft → autopilot-send queue → provider accepted
```

## Decisions made (don't relitigate)

- Never reintroduce full `state` on `read_workspace_state_for_loop`
- Autopilot fail-closed: ready + live critics + Sequences + entitlement
- HOLD when Microsoft dropzones empty
- Interviewer prep must never send/Autopilot to candidate email
- Never deploy with confirm whose SHA ≠ `git rev-parse HEAD`
- 0077 must DROP before recreate when removing parameter defaults
- Workspace UUID for Mantu admin loop: `0d179005-e8e2-4b99-8b9a-b67453348005`

## Watch out

- Do not mark goal complete until Autopilot E2E evidence (ready green ≠ E2E)
- Quiet HOLD: if follow-up is only empty Graph dropzone check → reply HOLD and stop
- Assisted Manual LinkedIn ≠ Autopilot send path
