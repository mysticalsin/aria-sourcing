---
project: MSourcing / ARIA
shift: 405
agent: cursor-cloud
updated: 2026-08-29T21:45Z
status: rei-autopilot-matrix-hardened
---

# Handoff — Shift 405

## Current state

- **Branch / PR:** `cursor/rei-autopilot-send-b91d` → **PR #39** tip Autopilot matrix + sweep stale retry
- **CODE:** Autopilot path complete in source; enterprise matrix pins 0076/0077/0078
- **Live Fly:** `1665b39` / **0074**; Graph dropzones absent → **HOLD**

## Done this shift

1. `mergeOutreachMessageScheduled` retries once on `stale_token` (multi-message sweep)
2. Enterprise E2E matrix: Autopilot 0076/0077/0078 + prep critics pins
3. Cron jobs catalog + INBOUND_REPLY_AUTOPILOT honesty for prep Autopilot
4. e2e-workflow-test prep message: Autopilot-capable

## Blockers (ops only)

1. Deploy tip + **0076** + **0077** + **0078**
2. Settings HeyReach Save; entitle; arm Sequences; `ARIA_LOOP_WORKSPACE_IDS`
3. Graph dropzones for live Teams
4. WA cold Meta template / HeyReach `{message}`

## Next steps

```bash
bash scripts/print-fly-deploy-confirm.sh && bash scripts/fly-deploy-now.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
bash scripts/run-enterprise-e2e-partial.sh
```

## Decisions made (don't relitigate)

- Never reintroduce full `state` on `read_workspace_state_for_loop`
- Autopilot fail-closed: ready + live critics + Sequences + entitlement
- HOLD when Microsoft dropzones empty
- Pre-existing enterprise-matrix 4 FAILs (PR #36 / Graph probe / PARTIAL E2E) are out of this PR's Autopilot scope

## Watch out

- Deploy tip with 0078 together
- Sweep without `ARIA_LOOP_WORKSPACE_IDS` is unconfigured no-op
