---
project: MSourcing / ARIA
shift: 161
agent: cursor-cloud
updated: 2026-08-27 UTC
status: awaiting-microsoft-entra-and-deploy-confirm
---

# Handoff — Shift 161

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#32**
- **Tip:** includes HeyReach E2E step + migration floor `>= 0066`
- **Live DB:** intake mailbox routes active for `talent@mantu.com` + `twalteur@amaris.com` (purpose=intake)
- **Live loop:** workspace switchboard armed (`set_sourcing_loop_controls` updated); loop machine started
- **Live webhook:** HMAC `/api/webhooks/email-inbound` accepts signed payloads (200) after arm; **stale image** returns `classifyQueued` (not tip `jobQueued`/`requisition_parse`) — tip deploy required
- **HeyReach:** allowlisted + connected (16 tools)
- **Still blocked:** 6 Azure/Entra secrets + `ARIA_PROD_DEPLOY_CONFIRM`; ready `ba88302`/mig `0060`/Graph **404**

## Done this shift

- Registered intake routes so webhook hire-need can resolve tenant without Outlook yet
- Armed sourcing loop controls; verified webhook auth+enqueue on live
- E2E asserts HeyReach allowlist + connected workspace MCP

## Next steps

1. Owner: `/tmp/owner-microsoft.env` → `fly-apply-owner-microsoft-secrets.sh`
2. `bash scripts/print-fly-deploy-confirm.sh` → export confirm → `fly-deploy-now.sh`
3. Connect Outlook + Enable webhook (Graph push)
4. `eval "$(bash scripts/print-fly-e2e-env.sh --export)" && bash e2e-workflow-test.sh`
5. Goal complete only on ready ok + mig>=0066 + tip build + Graph200 + E2E PASS

## Decisions made (don't relitigate)

- PR #32 supersedes #29–#31
- No invent Azure secrets / deploy confirm
- Migration floor >= 0066
- Do not hand-apply 0061–0066 via ad-hoc SQL (use bootstrap via fly-deploy-now)

## Watch out

- Stale image webhook response shape ≠ tip; E2E will fail closed until tip deploy
- Intake routes without Graph connection are HMAC-only; Outlook Connect still required for push intake
