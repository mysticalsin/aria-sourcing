---
project: MSourcing / ARIA
shift: 394
agent: cursor-cloud
updated: 2026-08-29T20:10Z
status: rei-autopilot-fail-closed-hardened
---

# Handoff — Shift 394

## Current state

- **Branch / PR:** `cursor/rei-autopilot-send-b91d` → **PR #39**
- **Fail-closed:** autopilot dispatch only when `qualityStatus === "ready"` + `criticsPassed === true`; worker matches; cron no longer defaults critics true
- **0076:** email enqueue requires approval; mint requires sequences armed
- **Settings:** `updateSettingsPersisted` for HeyReach save (await workspace write)
- **Live Fly:** still `1665b39` / **0074**; Graph dropzones absent → **HOLD**; no deploy confirm

## Done this shift

1. Critics fail-closed (decision + cron + worker)
2. Migration 0076: email approval gate + mint sequences check
3. HeyReach Settings persist await; roles/reply/email/fleet copy honesty
4. Cron jobs catalog includes autopilot-send-outreach
5. Tests: needs_review gate + migration/worker pins

## Blockers

1. Deploy tip + apply **0076** (needs `ARIA_PROD_DEPLOY_CONFIRM`)
2. Operator: Settings → LinkedIn stack → Save HeyReach API
3. Graph dropzones empty — strict PASS HOLD

## Next steps

```bash
bash scripts/print-fly-deploy-confirm.sh
# export ARIA_PROD_DEPLOY_CONFIRM=… then:
bash scripts/fly-deploy-now.sh
# Settings → Save HeyReach API; arm Sequences; entitle autopilot
bash scripts/run-enterprise-e2e-partial.sh
```

## Decisions made (don't relitigate)

- Settings vault + campaign first-class; Fly env optional
- Autopilot ON + Sequences + critics ready → auto-queue; else human review
- HOLD when Microsoft dropzones empty

## Watch out

- Client: import `heyReachSettingsReady` from `heyreach-config`
- Direct HeyReach API without live seat still allowed as fallback in dispatch
