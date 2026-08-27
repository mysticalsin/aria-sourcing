---
project: MSourcing / ARIA
shift: 128
agent: cursor-cloud
updated: 2026-08-27 UTC
status: code-complete-awaiting-owner-deploy
---

# Handoff — Shift 128

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#31** open
- **Tip work:** LangGraph fail-stops + draft_quality intent; Fly E2E refuses canned drafts
- **Local gate:** green; audit **42/42**; mantu-recruiting-e2e-full **33/33**; mantu-e2e-loop **12/12**
- **Fly live:** build `ba88302`, migration **0060**, Graph **404** — still needs owner tip deploy + **0066**
- **Owner blockers:** `ARIA_PROD_DEPLOY_CONFIRM`; `MICROSOFT_*`; `EMAIL_INBOUND_WEBHOOK_SECRET`; `GOTRUE_EXTERNAL_AZURE_*`; admin E2E creds

## Done this shift

- `recruiting-graph.ts`: `intent` full|draft_quality; parse fail → END; `interview_scheduled` only with `bookingId`
- `generate-outreach-draft`: `intent: "draft_quality"` + rejects fake `interview_scheduled`
- `e2e-workflow-test.sh`: Fly fail-closed on canned Hermes drafts (`ARIA_ALLOW_CANNED_DRAFT_E2E`); Entra surface check
- Prior: `fly-deploy-now.sh` stages tip `ARIA_EXPECTED_*` ledger identity (0066 floor)

## Blockers

- Live Fly cannot advance without owner confirm + secrets

## Next steps

1. Owner: `bash scripts/fly-enterprise-activate.sh $(git rev-parse HEAD)`
2. Owner: set `GOTRUE_EXTERNAL_AZURE_*` + `MICROSOFT_*` + `EMAIL_INBOUND_WEBHOOK_SECRET` before deploy
3. Owner: `bash scripts/print-fly-deploy-confirm.sh` → `bash scripts/fly-deploy-now.sh`
4. Owner: `bash scripts/print-fly-e2e-env.sh` + admin creds → `bash e2e-workflow-test.sh`
5. Agent timer: recheck `/api/ready` for build=tip + migration `0066_*`; run E2E if creds present

## Decisions made (don't relitigate)

- PR #31 supersedes closed #29 and #30
- No Fly deploy without `ARIA_PROD_DEPLOY_CONFIRM`
- Skip Actions billing failures; local gate is authority
- Target migration **0066**
- Deploy refreshes `ARIA_EXPECTED_*` to tip ledger
- Draft cron uses `draft_quality` intent — never claims booking without `bookingId`

## Watch out

- Worker still advances jobs via shared JSON transitions (not `runRecruitingGraph` between handlers); graph is stage authority for draft cron + observability
- Live Graph route 404 until tip deploy
