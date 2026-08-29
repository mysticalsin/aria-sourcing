---
project: MSourcing / ARIA
shift: 396
agent: cursor-cloud
updated: 2026-08-29T20:25Z
status: rei-dispatch-tests-green
---

# Handoff — Shift 396

## Current state

- **Branch / PR:** `cursor/rei-autopilot-send-b91d` → **PR #39**
- **Tests:** `rei-autopilot-dispatch` (mocked mint→enqueue Email/WA/LI), heyreach workspace-state parse pins
- **Live Fly:** `1665b39` / **0074**; Graph dropzones absent → **HOLD**; no deploy confirm

## Done this shift

1. `tests/rei-autopilot-dispatch.mts` — entitlement/sequences/critics/email/WA/HeyReach queue paths
2. `heyReachSettingsFromWorkspaceState` pure helper + unit pins
3. Registered dispatch suite in test-manifest

## Blockers

1. Deploy tip + **0076**
2. Operator Settings HeyReach API after deploy
3. Graph dropzones empty — strict PASS HOLD

## Next steps

```bash
bash scripts/print-fly-deploy-confirm.sh && bash scripts/fly-deploy-now.sh
# Settings → Save HeyReach API; entitle autopilot; arm Sequences
bash scripts/run-enterprise-e2e-partial.sh
```

## Decisions made (don't relitigate)

- Settings vault + campaign first-class; Fly env optional
- Autopilot fail-closed: qualityStatus=ready + criticsPassed
- interview_prep_send claimable after live book
- HOLD when Microsoft dropzones empty

## Watch out

- Run dispatch tests with `--experimental-test-module-mocks`
- Client: `heyReachSettingsReady` from `heyreach-config`
