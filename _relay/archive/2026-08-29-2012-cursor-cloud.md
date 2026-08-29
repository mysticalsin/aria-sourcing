---
project: MSourcing / ARIA
shift: 395
agent: cursor-cloud
updated: 2026-08-29T20:20Z
status: interview-prep-loop-wired
---

# Handoff — Shift 395

## Current state

- **Branch / PR:** `cursor/rei-autopilot-send-b91d` → **PR #39** tip includes interview_prep claim + enqueue
- **Pipeline:** `first_interview_book` → `interview_prep_send` (was empty; prep jobs were never claimed)
- **Live Fly:** `1665b39` / **0074**; Graph dropzones absent → **HOLD**; no deploy confirm

## Done this shift

1. Added `interview_prep_send` to `pipeline-transitions.json` (claimable by loop)
2. Live Graph book enqueues `interview_prep_send` when provider `eventId` present
3. Worker tests: live book asserts prep enqueue; tick test covers prep handler

## Blockers

1. Deploy tip + **0076** (needs deploy confirm)
2. Settings HeyReach key after deploy
3. Graph dropzones empty — live Teams book + strict PASS HOLD

## Next steps

```bash
bash scripts/print-fly-deploy-confirm.sh
bash scripts/fly-deploy-now.sh
# Settings → Save HeyReach API; entitle autopilot; arm Sequences
bash scripts/run-enterprise-e2e-partial.sh
```

## Decisions made (don't relitigate)

- Prep drafts stay Needs Approval / dryRun (human send)
- Autopilot fail-closed: qualityStatus=ready + criticsPassed
- HOLD when Microsoft dropzones empty

## Watch out

- Dry-run interview propose does **not** enqueue prep (no provider event)
- Client: `heyReachSettingsReady` from `heyreach-config`
