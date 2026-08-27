---
project: MSourcing / ARIA
shift: 146
agent: cursor-cloud
updated: 2026-08-27 UTC
status: code-complete-awaiting-owner-deploy
---

# Handoff — Shift 146

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#31** open (supersedes closed #29, #30)
- **Tip:** `e4ab4b8` (`e4ab4b87aae275fbc7bf789c675f50643bc89423`)
- **Local gate:** green; audit **45/45**
- **Fly auth:** `production-readiness/.fly-token.env` works for flyctl (env `FLY_API_TOKEN` alone is unauthorized)
- **Fly live:** build `ba88302` / mig **0060** / Graph **404** / `/api/ready` not_ready
- **`ARIA_PROD_DEPLOY_CONFIRM`:** unset (agent will not invent it)

## Live secrets inventory (aria-mantu-app)

**Present:** CRON_SECRET, DATA_ENCRYPTION_KEY, GITHUB_TOKEN, KIMI_*, TAVILY_API_KEY, SUPABASE_SERVICE_ROLE_KEY, stale ARIA_EXPECTED_*/ARIA_RELEASE_SHA

**MISSING (blocks M365 E2E):** EMAIL_INBOUND_WEBHOOK_SECRET, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_REDIRECT_URI, ARIA_LOOP_KILL_SWITCH, ANTHROPIC_API_KEY (or OPENAI_API_KEY)

**aria-mantu-auth MISSING:** GOTRUE_EXTERNAL_AZURE_* (only DB URL + JWT present)

## Done this shift

- Recovered working Fly token path; inventoried live secrets vs enterprise checklist
- Re-requested owner secrets + deploy external action with exact MISSING list

## Next steps

1. Owner: set MISSING Fly secrets via `bash scripts/print-fly-secrets-checklist.sh`
2. Owner: `bash scripts/fly-enterprise-activate.sh $(git rev-parse HEAD)` → `print-fly-deploy-confirm.sh` → export confirm → `fly-deploy-now.sh`
3. Owner: connect Outlook seat; provide ADMIN_* + EMAIL_INBOUND_WEBHOOK_SECRET to agent
4. Agent: ready ok + `0066_*` + Graph 200 + `e2e-workflow-test.sh` PASS → mark goal complete

## Decisions made (don't relitigate)

- PR #31 supersedes closed #29 and #30
- No Fly deploy without `ARIA_PROD_DEPLOY_CONFIRM` — use `bash scripts/print-fly-deploy-confirm.sh`
- Target migration **0066**
- Use `.fly-token.env` for flyctl from this agent (do not commit token values)
- Never set PLACEHOLDER Microsoft/webhook secrets on Fly

## Watch out

- Env `FLY_API_TOKEN` (47 chars) is stale/unauthorized; prefer `.fly-token.env`
- Loop process is started but kill-switch secret unset (defaults engaged)
