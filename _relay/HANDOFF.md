---
project: MSourcing / ARIA
shift: 102
agent: cursor-cloud
updated: 2026-08-27 UTC
status: m365-live-status-ci-infra-blocked
---

# Handoff — Shift 102

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#30**
- **Local:** typecheck green; audit matrix **16/16**; npm audit high **0**
- **CI:** still no runners (`steps:[]`, ~3s) on `aa10f95` and later — org-wide
- **Fly live:** health 200; demo-login 404; LinkedIn routes 401 (present); migration **0060**; ready 503 (`agentFrameworks:false` — Track C, cannot opt out per readiness test)
- **M365 UI:** Settings stack now loads live `/api/email/connections` (no hardcoded false)

## Done this shift

- Microsoft365Stack: live OAuth/mailbox/calendar/inbound status from connections API
- Audit matrix +1 requirement for live connection status
- fly-golive-linkedin preflight target → 0062

## Blockers (ops — cannot finish from agent alone)

1. GitHub Actions runners / billing
2. Protected Fly deploy (`ARIA_PROD_DEPLOY_CONFIRM` + full `.fly-secrets.env` with PG passwords)
3. Entra + `MICROSOFT_CLIENT_*` + `EMAIL_INBOUND_WEBHOOK_SECRET` + `ADMIN_*` for e2e-workflow-test.sh
4. Apply migrations **0061–0062** via bootstrap (DB still at 0060)

## Next steps

1. Restore Actions → green CI on tip SHA
2. Owner: `scripts/fly-golive-linkedin.sh` / Deploy Aria Mantu workflow with confirm token
3. Set M365 + webhook secrets; run `e2e-workflow-test.sh`

## Decisions made (don't relitigate)

- `/api/ready` cannot opt out of agentFrameworks in production (readiness test locks this)
- agentFrameworks=false is Track C (Flowise), not recruiting-loop critical path
- Default seed zero candidates; historical demo separate

## Watch out

- `.fly-secrets.env` currently has only `FLY_SUPABASE_ANON_KEY` — deploy/migrate needs full example set
- Production deploy requires reviewed `ARIA_PROD_DEPLOY_CONFIRM` — do not bypass
