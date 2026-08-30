---
project: MSourcing / ARIA
shift: 398
agent: cursor-cloud
updated: 2026-08-29T21:05Z
status: rei-book-gate-idempotent-draft
---

# Handoff — Shift 398

## Current state

- **Branch / PR:** `cursor/rei-autopilot-send-b91d` → **PR #39**
- **This shift:** Live Teams book gated on Autopilot+Sequences; stable draft message ids (no retry double-send); reply follow-up draft (step 2 + prompt); worker tests for autopilot-send wiring + disarmed book
- **Live Fly:** `1665b39` / **0074**; **0076 not applied**; Graph dropzones absent → **HOLD**; no `ARIA_PROD_DEPLOY_CONFIRM`

## Done this shift

1. `workspaceAutopilotArmed` in sourcing-loop-worker — live `confirm-calendar-book` only when armed
2. `stableOutreachMessageId` + draft cron trigger/intent/sequenceStep for reply follow-ups
3. Worker tests: autopilot-send → Scheduled; needs_review skips; book skipped when disarmed
4. Reply panel / outreach card / INBOUND_REPLY_AUTOPILOT docs honesty

## Blockers

1. Deploy tip + **0076**
2. Settings HeyReach API + live seat; entitle Autopilot; arm Sequences
3. Graph dropzones empty — strict PASS HOLD
4. WhatsApp *inbound reply* auto-queue still inserts `blocked` (agent-spec path) — separate from first-touch REI WA cold template

## Next steps

```bash
bash scripts/print-fly-deploy-confirm.sh && bash scripts/fly-deploy-now.sh
# Settings → HeyReach; entitle; arm Sequences
bash scripts/run-enterprise-e2e-partial.sh
# Optional next code: WhatsApp inbound decideAutopilot(entitlement) → mint+queue
```

## Decisions made (don't relitigate)

- Settings vault + campaign first-class; Fly env optional
- Autopilot fail-closed: qualityStatus=ready + criticsPassed
- WhatsApp cold: Meta template or open window; LinkedIn durable seat only
- Live interview book only when Autopilot entitled + Sequences armed; else dry-run propose
- Stable draft message ids for loop retries
- HOLD when Microsoft dropzones empty

## Watch out

- Worker tests: `stubWorkspaceAutopilotArmed(client)` for live book paths
- Dispatch tests need `--experimental-test-module-mocks`
