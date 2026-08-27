---
project: MSourcing / ARIA
shift: 124
agent: cursor-cloud
updated: 2026-08-27 UTC
status: code-complete-awaiting-owner-deploy
---

# Handoff — Shift 124

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#31** open · tip `cd795fd`
- **Local gate:** green (`tsc` + `npm test`); audit **35/35**; mantu E2E **28/28**
- **Fly live:** build `ba88302`, migration **0060** — needs tip deploy through **0065**
- **Owner blockers:** `ARIA_PROD_DEPLOY_CONFIRM` unset; M365/webhook/Entra Fly secrets missing; admin E2E creds absent

## Done this shift

- Live email MIME now applies `mantuEmailHtmlWrapper` server-side (`email-send` + unsubscribe HTML footer merge)
- Confirm-slot booking uses `interviewProposal.agenda` or `mantuFirstInterviewAgenda`
- Multi-agent quality = three separate LLM critic calls
- Shared `pipeline-transitions.json` for LangGraph + loop worker; `GRAPH_STAGE_TO_JOB_KIND` wired
- Ignite is webhook-first (no empty `email_sync`)
- Microsoft OAuth callback scope fallback includes `Calendars.ReadWrite`
- Audit matrix expanded to 35/35; manifest contract freeze updated

## Owner activation (single entry)

```bash
bash scripts/fly-enterprise-activate.sh $(git rev-parse HEAD)
# export deploy vars from output, then:
bash scripts/fly-deploy-now.sh
# set Fly M365/webhook/Entra secrets, then:
bash scripts/print-fly-e2e-env.sh
export ADMIN_EMAIL='…' ADMIN_PASSWORD='…'
bash e2e-workflow-test.sh
```

Exact deploy one-liner (regenerate if tip moves):

```bash
bash scripts/print-fly-deploy-confirm.sh
# then export ARIA_RELEASE_SHA + ARIA_PROD_DEPLOY_CONFIRM and run fly-deploy-now.sh
```

## Completion audit

Code/tests/PR **#31**: stronger (P0 MIME/agenda/critics/spine closed). Live Fly E2E: still blocked on owner deploy + secrets.

## Decisions made (don't relitigate)

- **PR #31 supersedes closed #29 and #30**
- No Fly deploy without `ARIA_PROD_DEPLOY_CONFIRM`
- Use `bash scripts/print-fly-deploy-confirm.sh` for exact deploy one-liner
- LinkedIn send stays 409 assisted-manual
- Calendar live book only via `/api/calendar/event` + `confirmLive`
- Skip Actions billing failures; local gate is authority

## Watch out

- Closing PRs does not deploy or merge; code lives on feature branch until Fly tip + 0065
- `email_sync` remains a valid job kind for reply batches with `inboundIds`; ignite no longer seeds empty ones
