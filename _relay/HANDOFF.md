---
project: MSourcing / ARIA
shift: 158
agent: cursor-cloud
updated: 2026-08-27 UTC
status: awaiting-microsoft-entra-and-deploy-confirm
---

# Handoff — Shift 158

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#31** open (supersedes closed #29, #30)
- **Tip:** `053fb0f11f39fe209d99c5569beb70dd2b11e300` (CRON/Graph E2E fail-closed + ADMIN /tmp auto-load)
- **Local gate:** green; audit **45/45**
- **PR:** re-open after #31 closed — new draft on same branch
- **Fly missing (6):** MICROSOFT_CLIENT_ID/SECRET + GOTRUE_EXTERNAL_AZURE_*
- **Stale deploy:** `ba88302` / mig **0060** / Graph validationToken **404**; `ARIA_PROD_DEPLOY_CONFIRM` unset in shell
- **Agent-owned ready in /tmp:** webhook + cron secrets; ADMIN `Twalteur@amaris.com` password reset+verified via GoTrue (admin role); HeyReach MCP/API keys (mode 600; never commit)
- **Drop-zone:** `/tmp/owner-microsoft.env` and `production-readiness/.owner-microsoft.env` still absent

## Done this shift

- E2E fail-closed: Fly requires `CRON_SECRET` (or `/tmp/aria-e2e-cron-secret`) unless `ARIA_ALLOW_SKIP_CRON_E2E=1`
- E2E fail-closed: if Outlook connected, require `graphSubscription.active`
- Live seat pick prefers subscription-active connections; partial fallback only with `ARIA_ALLOW_PARTIAL_M365_E2E=1`
- `print-fly-e2e-env --export` emits CRON + ADMIN from `/tmp` when present
- Stored owner-provided ADMIN + HeyReach material under `/tmp/aria-e2e-*` only

## Next steps

1. Owner: fill `/tmp/owner-microsoft.env` (from `production-readiness/.owner-microsoft.env.example`) or export Azure/Entra → `bash scripts/fly-apply-owner-microsoft-secrets.sh`
2. `bash scripts/print-fly-deploy-confirm.sh` → export confirm → `bash scripts/fly-deploy-now.sh`
3. Connect Outlook + Enable webhook; HeyReach via Settings if LinkedIn path needed
4. Agent: `eval "$(bash scripts/print-fly-e2e-env.sh --export)"` → `bash e2e-workflow-test.sh`
5. Success: ready ok + mig `0066_*` + Graph 200 + E2E PASS → goal complete

## Decisions made (don't relitigate)

- PR #31 supersedes closed #29 and #30
- No Fly deploy without `ARIA_PROD_DEPLOY_CONFIRM`
- Never invent Azure client id/secret; apply refuses PLACEHOLDER
- Drop-zone / `/tmp/aria-e2e-*` must never be committed
- LinkedIn send stays 409 assisted-manual; calendar live book only via confirmLive

## Watch out

- Rotate webhook/cron if `/tmp` lost after reboot
- Do not invent or export deploy confirm to bypass gate
- Queued follow-ups may deliver ADMIN/HeyReach again — already staged in `/tmp`
