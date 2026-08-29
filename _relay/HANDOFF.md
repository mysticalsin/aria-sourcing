---
project: MSourcing / ARIA
shift: 393
agent: cursor-cloud
updated: 2026-08-29T20:00Z
status: heyreach-settings-discoverable
---

# Handoff — Shift 393

## Current state

- **Branch / PR:** `cursor/rei-autopilot-send-b91d` → **PR #39**
- **Settings:** HeyReach API + MCP in LinkedIn stack; setup guide has **Add HeyReach** step; Test Integration honors API-only config
- **Live Fly:** `1665b39` / **0074** — tip not deployed; Graph dropzones absent → **HOLD**
- No `ARIA_PROD_DEPLOY_CONFIRM` in agent env — cannot apply 0076 / deploy from here

## Done this shift

1. Setup guide HeyReach step → `#linkedin-outreach-stack`
2. Integration Test for `int_heyreach` succeeds on Settings API (MCP optional)
3. Secrets checklist prefers Settings over Fly CLI
4. Migrations preserve `settings.heyreach`; toggleSeatLive notes updated

## Blockers

1. Deploy tip + migration **0076** (needs owner deploy confirm)
2. Operator paste HeyReach key + campaign in Settings (after deploy)
3. Graph dropzones empty — strict PASS HOLD

## Next steps

```bash
# owner: print confirm + deploy tip of PR #39
bash scripts/print-fly-deploy-confirm.sh
# after deploy: Settings → LinkedIn stack → Save HeyReach API
bash scripts/run-enterprise-e2e-partial.sh
# Graph only when /tmp/owner-* appear
```

## Decisions made (don't relitigate)

- Settings vault + campaign id first-class; Fly env optional override
- Autopilot OFF → human Approve → Send; ON → critics → queue
- HOLD when Microsoft dropzones empty

## Watch out

- Import `heyReachSettingsReady` from `heyreach-config` in client components
- Audit matrix 4 FAIL entries are tip/PR#36 bookkeeping — not REI regressions
