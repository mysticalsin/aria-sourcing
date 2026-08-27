---
project: MSourcing / ARIA
shift: 119
agent: cursor-cloud
updated: 2026-08-27 UTC
status: code-complete-awaiting-owner-deploy
---

# Handoff — Shift 119

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#30** (supersedes closed **#29**) · tip `0908086`
- **Local gate:** `npx tsc --noEmit && npm test` green (170s); audit **30/30**; mantu E2E **28/28**
- **Fly live:** build `ba88302`, migration **0060**, `/api/ready` not_ready; webhook route returns 401 (present)
- **Owner blockers:** `ARIA_PROD_DEPLOY_CONFIRM` unset; `.fly-secrets.env` absent

## Done this shift

- Re-ran full test gate — green
- Re-ran audit matrix (30/30) and mantu E2E (28/28)
- Re-ran `fly-golive-mantu-e2e.sh` preflight — confirms migration gap 0060→0065

## Blockers (owner)

Run from clean checkout on this branch:

```bash
bash scripts/print-fly-deploy-confirm.sh   # prints exact ARIA_RELEASE_SHA + confirm string
# paste and run the emitted export lines, then:
bash scripts/fly-deploy-now.sh
```

Then set Fly secrets (Entra, M365 OAuth, LLM, webhook) and:

```bash
ADMIN_EMAIL=… ADMIN_PASSWORD=… ANON_KEY=… EMAIL_INBOUND_WEBHOOK_SECRET=… \
  bash e2e-workflow-test.sh
```

## Next steps

1. Owner runs deploy one-liner (above) through migration **0065**
2. Configure production secrets per `scripts/fly-golive-mantu-e2e.sh` step 4
3. Run `e2e-workflow-test.sh` against Fly — proves live loop
4. Mark goal complete only after live E2E passes

## Completion audit

| Requirement | Status | Evidence |
|---|---|---|
| Webhook-triggered Outlook intake (no polling) | code ✓ live ✗ | `ensureGraphMailSubscription`, audit row |
| LangChain pipeline (parse→source→top10→outreach→quality→calendar) | code ✓ live ✗ | mantu E2E 28/28, audit 30/30 |
| M365 stack (Entra, Outlook, calendar, Teams) | code ✓ live ✗ | routes + UI wired; needs Fly secrets |
| Production-ready UX (no fake/skeleton) | code ✓ | demo-login 404 on Fly |
| Green test gate | ✓ | `npx tsc --noEmit && npm test` exit 0 |
| E2E script | ✓ (script) live ✗ | `e2e-workflow-test.sh` ready; blocked on deploy |
| Audit matrix | ✓ | 30/30 |
| PR deliverable | ✓ | #30 open, mergeable |

## Decisions made (don't relitigate)

- **#30 supersedes #29**
- Fly-only for enterprise; skip Vercel prod
- No Fly deploy without `ARIA_PROD_DEPLOY_CONFIRM`
- Skip Actions billing failures (empty runners); local gate is authority
- LinkedIn send stays 409 assisted-manual; calendar live book via `confirmLive`

## Watch out

- Live `/api/ready` shows `agentFrameworks=false` (Track C Flowise) — does not block recruiting loop
- CI checks on #30 fail due to billing, not code regressions
