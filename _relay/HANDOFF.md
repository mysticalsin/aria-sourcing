---
project: MSourcing / ARIA
shift: 117
agent: cursor-cloud
updated: 2026-08-27 UTC
status: code-complete-awaiting-owner-deploy
---

# Handoff — Shift 117

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#30** (supersedes closed **#29**) · tip `8c736fa`
- **Local gate:** `npx tsc --noEmit && npm test` green; audit **30/30**; mantu E2E **28/28**
- **Fly live:** build `ba88302`, migration **0060**, `agentFrameworks:false`, `/api/ready` not_ready
- **Source target:** migration **0065**; golive preflight prints deploy command for tip SHA
- **Owner blockers:** `ARIA_PROD_DEPLOY_CONFIRM` unset; Entra/Graph/LLM secrets absent in agent env

## Completion audit (objective vs evidence)

| Requirement | Code/tests | Live Fly |
|-------------|------------|----------|
| Webhook Outlook intake (no polling) | Graph webhook + ensure/repair UI; audit ✓ | Deploy 0064–0065 + Graph secrets |
| LangChain pipeline parse→source→top10→outreach→book | recruiting-graph + worker chain; audit ✓ | Deploy + LLM keys |
| Mantu outreach + multi-agent quality | quality pipeline + critics_required; audit ✓ | LLM keys on Fly |
| Teams/Outlook interview (propose + confirmLive) | calendar_book + calendar UI; audit ✓ | Deploy 0065 + Graph |
| M365 stack (Entra, Outlook, calendar) | Settings wired; Entra flag off until secrets | Owner secrets |
| No fake/skeleton prod UX | demo off on fly.app.toml; settings gates; audit ✓ | Deploy tip SHA |
| Green test gate | npm test green locally | — |
| E2E script + audit matrix | e2e-workflow-test.sh + 29/29 matrix | Needs deployed E2E |
| PR deliverable | **#30** open (draft cleared shift 117) | Owner merge/deploy |

## Done this shift

- Ran golive preflight: live **0060** vs source **0065** blocker documented with exact `ARIA_PROD_DEPLOY_CONFIRM` one-liner
- Confirmed **#29 closed**; **#30** is the enterprise E2E PR
- Marked PR #30 ready for human review (code complete; deploy blocked on owner)

## Blockers (owner)

```bash
ARIA_RELEASE_SHA=8c736fa0880c6c66c132ad2e0641b7f1c7fc2080 \
ARIA_PROD_DEPLOY_CONFIRM=aria-production-release-v1:fly-deploy-now:8c736fa0880c6c66c132ad2e0641b7f1c7fc2080:aria-mantu-bootstrap,aria-mantu-app \
  bash scripts/fly-deploy-now.sh
```

Then: Entra secrets, M365 OAuth, LLM keys, `bash e2e-workflow-test.sh` against Fly.

## Next steps

1. Owner runs deploy command above
2. Set Fly secrets (Graph, webhook, Entra, LLM)
3. Prove live webhook + confirmLive calendar; close goal

## Decisions made (don't relitigate)

- **#30 supersedes #29** (different scope; #29 closed)
- Skip Actions billing; Fly-only; LinkedIn 409 assisted-manual
- Calendar live book only via `/api/calendar/event` + confirmLive
- Human intake UI may show providerWarning heuristic; autonomous cron fail-closed

## Watch out

- Do not Fly-mutate without `ARIA_PROD_DEPLOY_CONFIRM`
- agentFrameworks=false does not block recruiting loop (Track C)
