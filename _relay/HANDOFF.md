---
project: MSourcing / ARIA
shift: 245
agent: cursor-cloud
updated: 2026-08-28T06:15Z
status: gate-green-audit-matrix-0071-prep-dispatch
---

# Handoff — Shift 245

## Current state

- **Branch tip:** `cursor/enterprise-autopilot-b91d` (ahead — interview prep + audit matrix)
- **Live Fly:** **`6ed278e`** (migration **0070**); tip adds **0071** + prep dispatch — golive pending
- **Test gate / audit:** green; **58/58** (`tests/enterprise-e2e-audit-matrix.mts`)
- **Audit matrix:** [`_relay/e2e-audit-matrix.md`](e2e-audit-matrix.md) — routes, loop, compliance, ops blockers
- **Live E2E:** PARTIAL M365 (owner secrets); extended script adds reply webhook + prep pins (step 2c)
- **PR:** [#35](https://github.com/mysticalsin/aria-sourcing/pull/35)
- **Deploy confirm:** `bash scripts/print-fly-deploy-confirm.sh` when tip code changes

## Done this shift

- **`interview_prep_send`** loop kind (mig **0071**): live book → enqueue → worker → approval-gated prep drafts
- **`/api/booking/interview-prep`** + **`/api/cron/interview-prep-dispatch`** + `handleInterviewPrepSend`
- E2E step **2c**: reply webhook classify + prep wiring pins
- **`_relay/e2e-audit-matrix.md`** + **`production-readiness/STATUS.md`** updated (0071, 58/58)

## Blockers (owner)

1. **M365 secrets** (6) — `bash scripts/az-configure-existing-graph-app.sh --apply` or `/tmp/owner-microsoft.env`
2. **Golive 0071** — `bash scripts/fly-golive-mantu-e2e.sh` after push
3. Full Fly E2E without `ARIA_ALLOW_PARTIAL_M365_E2E=1`; **expect step 3c PASS** with `provenance=live` when quota allows

## Next steps

1. Owner: Entra app + Fly M365 secrets
2. Golive tip (0071) to Fly
3. Full Fly E2E + browser walkthrough of audit matrix fail→pass items
4. Set `ARIA_LOOP_KILL_SWITCH=false` only after P-1/P-2 on Docker host (A-1)

## Decisions made (don't relitigate)

- **Production = Fly only** (`https://aria-mantu-app.fly.dev`). All golive, E2E, migrations, and owner secrets target Fly — not Vercel, not GitHub Actions CI.
- Interview prep via approval queue — no auto-send
- LinkedIn policy unchanged (409 manual-required)

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh          # tip vs live
bash scripts/fly-golive-mantu-e2e.sh             # preflight checklist
bash scripts/fly-golive-mantu-e2e.sh $(git rev-parse HEAD)  # after owner remint
ARIA_ALLOW_PARTIAL_M365_E2E=1 bash scripts/run-enterprise-e2e-partial.sh  # honest partial
```

- `interview_prep_send` is enqueued from UI book path, not `pipeline-transitions.json`
- Prep enqueue requires provider calendar receipt (`providerEventCreated`)
