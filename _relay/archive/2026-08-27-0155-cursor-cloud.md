---
project: MSourcing / ARIA
shift: 105
agent: cursor-cloud
updated: 2026-08-27 UTC
status: code-complete-awaiting-ops
---

# Handoff — Shift 105

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#30** tip `a27a151` (+ golive 0063 bump pending commit)
- **Loop chain:** campaign_create → sourcing_batch → shortlist top 10 → draft_generate (Mantu+quality) → calendar/Teams book (E2E dry-run)
- **Migrations in source:** through **0063** `append_outreach`
- **Local gate:** `npx tsc --noEmit` green; `npm test` 0 fail; audit matrix **18/18**
- **CI:** org-wide runner failure (jobs ~2–7s, no steps) on this branch **and** `main` — not a code Quality failure
- **Fly `aria-mantu-app`:** health 200; `/api/ready` 503 (`agentFrameworks:false`); migration still **0060** (need **0063**); webhook route present (401 without sig)

## Done this shift

- Committed E2E step 6: `POST /api/calendar/event` confirmLive:false + Teams flag assert (`e2e-workflow-test.sh`)
- Audit matrix row for calendar/Teams dry-run (18/18)
- Golive preflight target migration bumped to **0063**

## Blockers (owner / ops — goal NOT complete)

1. Restore GitHub Actions billing/runners (affects all branches)
2. Deploy release SHA through migration **0063** with `ARIA_PROD_DEPLOY_CONFIRM`
3. Set Fly secrets: `EMAIL_INBOUND_WEBHOOK_SECRET`, `MICROSOFT_CLIENT_*`, Entra/`NEXT_PUBLIC_ENABLE_AZURE_LOGIN`, `ARIA_WEB_INTERNAL_URL`, full `.fly-secrets.env`
4. Run `bash e2e-workflow-test.sh` against Fly with admin creds

## Next steps (ordered)

1. Owner: restore Actions → expect CI green on tip
2. Owner: `bash scripts/fly-golive-mantu-e2e.sh` then sanctioned deploy through 0063
3. Owner: set M365 + webhook secrets; prove `/api/ready` + E2E script
4. Mark goal complete only with: green CI (or infra waiver) + Fly at 0063 + deployed E2E evidence

## Decisions made (don't relitigate)

- LinkedIn send remains assisted-manual (409)
- `/api/ready` cannot env-opt-out of `agentFrameworks` in production (Flowise = Track C; 503 does not block recruiting loop code path)
- No production deploy without confirm token
- Default seed = zero candidates; webhook ids-only; parse via cron

## Watch out

- Do not treat empty Actions logs as test failures
- Do not deploy without secrets + confirm token
- VISION: LangGraph is state machine; Hermes/tool-loop remains sourcing authority
