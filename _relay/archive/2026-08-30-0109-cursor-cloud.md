---
project: MSourcing / ARIA
shift: 421
agent: cursor-cloud
updated: 2026-08-30T00:20Z
status: wire-path-fixed-awaiting-channels
---

# Handoff — Shift 421

## Current state

- **Branch:** `cursor/rei-autopilot-send-b91d` (PR #40)
- **Code tip:** removes remaining service_role `sourcing_loop_controls` SELECT hard blockers (dispatch-outbound wire, worker shortlist/arm, ignite, confirm-calendar, whatsapp-inbound) via shared `loadSourcingLoopControls`
- **Autopilot also surfaces `dispatchDue` stats** (queued ≠ wire sent)
- **External still HOLD:** Graph mock seats; HeyReach 0 LI accounts / 0 campaigns / empty settings.heyreach
- **Fly image:** may lag until tip remint+deploy

## Done this shift

1. Fixed post-enqueue wire hard blocker (dispatch-outbound)
2. Fixed organic shortlist Autopilot arming in worker
3. Shared controls helper; durable `sequences-not-armed` block instead of silent skip
4. Tests: dispatch 108, worker 46, autopilot-dispatch 23, heyreach-mcp 37, typecheck green

## Blockers (owner / external)

1. Graph dropzones → live mailbox for email `sent>0`
2. HeyReach portal LI account + campaign `{message}` → Settings campaignId + live HeyReach seat
3. GHA Actions budget (CI phantoms)

## Next steps

```bash
SHA=$(git rev-parse HEAD)
printf 'ARIA_RELEASE_SHA=%s\nARIA_PROD_DEPLOY_CONFIRM=aria-production-release-v1:fly-deploy-now:%s:aria-mantu-bootstrap,aria-mantu-app\n' "$SHA" "$SHA" > /tmp/owner-deploy-confirm.env
source /tmp/owner-deploy-confirm.env && bash scripts/fly-deploy-now.sh
# After Graph or HeyReach ready → sweep planted draft → expect sent>=1
```

## Decisions made (don't relitigate)

- Never table-SELECT `sourcing_loop_controls` from service_role — always `get_sourcing_loop_controls`
- Autopilot fail-closed; HOLD Graph dropzones empty
- Goal complete only on auto-send receipt (`sent>0` / provider acceptance)
- Workspace `0d179005-e8e2-4b99-8b9a-b67453348005`

## Watch out

- Cron `sent` count still includes durable `queued`; check result.dispatch / status `sent` for wire
- HeyReach CreateCampaign impossible with 0 LI accounts
