---
project: MSourcing / ARIA
shift: 176
agent: cursor-cloud
updated: 2026-08-27T16:20Z
status: tip-code-hardened-awaiting-deploy-confirm
---

# Handoff — Shift 176

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **PR #32** · tip advancing
- **Live Fly:** still build `ba88302` · mig `0060` · `/api/ready` not_ready · Graph **404**
- **Drop-zones:** absent; `ARIA_PROD_DEPLOY_CONFIRM` unset (will not invent — use `bash scripts/print-fly-deploy-confirm.sh` or Cursor secret)
- **Owner asks:** Cursor secrets for `ARIA_PROD_DEPLOY_CONFIRM` (+ optional MS client id/secret) OR `/tmp/owner-deploy-confirm.env`

## Done this shift

- Requested deploy-confirm + Microsoft credentials via Cursor secrets UI (and drop-zone external action)
- Waiter treats exported `MICROSOFT_CLIENT_ID`+`SECRET` as microsoft unlock (no PLACEHOLDER)
- Intake: hide Emergency sync when Graph webhook subscription is active

## Next steps

1. Owner: paste `ARIA_PROD_DEPLOY_CONFIRM` from `print-fly-deploy-confirm.sh` into Cursor secrets or `/tmp/owner-deploy-confirm.env`
2. Owner: Microsoft client id/secret when ready for Outlook OAuth
3. After tip: Connect Outlook → `e2e-workflow-test.sh`
4. Goal complete: ready ok + mig>=0066 + tip build + Graph200 + E2E PASS

## Decisions made (don't relitigate)

- PR #32 supersedes #29–#31
- Never invent Azure secrets or `ARIA_PROD_DEPLOY_CONFIRM` — use `print-fly-deploy-confirm.sh`
- Seat mode=live only after Graph webhook; LinkedIn 409 assisted-manual
- Owner skipped Entra MFA — secrets via portal/drop-zone OK; no device-code spam

## Watch out

- Tip SHA must match confirm string at deploy time
- GitHub Actions budget exhausted; local gate is authority
