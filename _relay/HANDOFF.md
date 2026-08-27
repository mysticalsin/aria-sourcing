---
project: MSourcing / ARIA
shift: 170
agent: cursor-cloud
updated: 2026-08-27T15:20Z
status: login-fixed-awaiting-tip-deploy-and-entra
---

# Handoff — Shift 170

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **PR #32** · tip `fa663ed`+
- **Live login:** twalteur@amaris.com GoTrue password reset verified (password grant OK, role=admin). Demo login remains disabled.
- **Fly `/api/ready`:** still `not_ready` on build `ba88302` — live image **ignores** `AGENT_FRAMEWORKS_REQUIRED=false` (old formula: production always requires frameworks). Tip has opt-out (`bbadf23`). Secret `AGENT_FRAMEWORKS_REQUIRED=false` is now set on aria-mantu-app for tip.
- **Graph:** still **404** until tip deploy
- **Entra / Microsoft:** owner **skipped** env setup actions — still MISSING 6 secrets; no drop-zone; no az login
- **Deploy confirm:** unset (will not invent)

## Done this shift

- Reset + verified Twalteur GoTrue password (admin role intact)
- Set Fly secret `AGENT_FRAMEWORKS_REQUIRED=false` (needed by tip; insufficient alone on ba88302)
- Owner skipped Entra MFA / secrets external actions — do not re-block on those

## Next steps

1. Owner: export confirm from `bash scripts/print-fly-deploy-confirm.sh` → `/tmp/owner-deploy-confirm.env` (or shell export) then `bash scripts/fly-deploy-now.sh` / golive — **required** for ready ok + Graph 200
2. Owner: provide Microsoft secrets (`/tmp/owner-microsoft.env`) when ready for Outlook E2E (skipped for now)
3. After tip: Connect Outlook (live) + webhook → `e2e-workflow-test.sh`
4. Goal complete: ready ok + mig>=0066 + tip build + Graph200 + E2E PASS

## Decisions made (don't relitigate)

- PR #32 supersedes #29–#31
- Never invent Azure secrets or deploy confirm
- Seat mode=live for Teams book
- Mantu Fly: AGENT_FRAMEWORKS_REQUIRED=false on tip

## Watch out

- ba88302 ready code cannot opt out of agentFrameworks — tip deploy mandatory for ready green
- Do not re-request skipped Entra MFA unless owner asks
