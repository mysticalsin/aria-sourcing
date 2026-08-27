---
project: MSourcing / ARIA
shift: 178
agent: cursor-cloud
updated: 2026-08-27T16:45Z
status: tip-code-hardened-awaiting-deploy-confirm
---

# Handoff — Shift 178

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **PR #32** · tip `43639f0`
- **Live Fly:** still `ba88302` / mig `0060` / Graph **404**
- **Unlock:** `ARIA_PROD_DEPLOY_CONFIRM` unset; drop-zones absent. Env has stale `ARIA_RELEASE_SHA=591a813` (ignore)
- **Owner:** paste confirm from `bash scripts/print-fly-deploy-confirm.sh` (must match tip HEAD `43639f0`)

## Done this shift

- Gate Microsoft Graph `mode=live`: fleet PATCH + create refuse without inbound route + active Graph sub (`src/lib/microsoft-seat-live.ts`)
- `ensure_graph_webhook` repairs inbound route and promotes seat to live
- Disconnect demotes seat to `mode=mock`
- Local gate green; audit matrix 45/45

## Next steps

1. Owner: `ARIA_PROD_DEPLOY_CONFIRM` for tip `43639f0` via Cursor secret or `/tmp/owner-deploy-confirm.env`
2. Owner: Microsoft client id/secret when ready
3. Tip deploy → Connect Outlook → `e2e-workflow-test.sh`
4. Goal complete: ready ok + mig>=0066 + tip build + Graph200 + E2E PASS

## Decisions made (don't relitigate)

- PR #32 supersedes #29–#31
- Never invent Azure secrets or `ARIA_PROD_DEPLOY_CONFIRM`
- Graph seat live only after inbound route + Graph subscription (OAuth, Enable webhook, fleet PATCH)
- Owner skipped Entra MFA — secrets via portal/Cursor OK

## Watch out

- Stale `ARIA_RELEASE_SHA` in env without confirm must not trigger deploy
- Confirm SHA must equal clean tree HEAD (`43639f0`)
- Actions budget exhausted; local gate is authority
