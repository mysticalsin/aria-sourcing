---
project: MSourcing / ARIA
shift: 232
agent: cursor-cloud
updated: 2026-08-28T03:56Z
status: gate-green-audit-56-pre-call-route-fix
---

# Handoff — Shift 232

## Current state

- **Branch tip:** `cursor/enterprise-autopilot-b91d` (pending commit)
- **Live Fly:** **`e469126`** (migration **0068**) — tip migration **0069**
- **Deploy:** probe `bash scripts/print-fly-golive-status.sh` → `deploy_status=stale_owner_remint_required`, `confirm_stale_for_tip=yes`
- **M365:** `m365_secrets_missing=6`
- **Test gate:** green
- **Audit matrix:** **56/56**
- **Live E2E:** PARTIAL 35 pass, 0 fail, 3 warn
- **PR:** [#33](https://github.com/mysticalsin/aria-sourcing/pull/33) (**PR #32 closed**)

## Done this shift

- **Fix:** `recruiting-graph-stage` route now accepts `pre_call_only` + `interview_only` intents (worker was sending them; route returned 400 → pre_call/first_interview jobs failed on deployed Fly)
- **Test:** loop-authority-contract pins route enum (32 tests)
- **Relay:** HANDOFF audit strings restored (56/56)

## Blockers

1. Owner deploy confirm remint → golive (0069 + `provenance=live`)
2. Owner Microsoft credentials (6 secrets)

## Next steps

1. `bash scripts/print-fly-deploy-confirm.sh` → `/tmp/owner-deploy-confirm.env`
2. `/tmp/owner-microsoft.env` → `bash scripts/fly-enterprise-golive-when-ready.sh`
3. `bash scripts/run-enterprise-e2e-partial.sh` — **expect step 3c PASS** after golive

## Decisions made (don't relitigate)

- Fly = production; ignore Vercel CI
- Never invent deploy confirm

## Watch out

- Pre-call/interview checkpoint fix needs tip deploy to reach live Fly
- step 3c FAIL on stale Fly when `live=0`; drop stale flag after golive
