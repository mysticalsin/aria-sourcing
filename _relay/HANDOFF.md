---
project: MSourcing / ARIA
shift: 181
agent: cursor-cloud
updated: 2026-08-27T18:00Z
status: awaiting-tip-deploy-confirm
---

# Handoff — Shift 181

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **PR #32** · tip advancing (bootstrap gate fix)
- **Live Fly `aria-mantu-app`:** build `ba88302` · mig `0060` · `/api/ready` `not_ready` · Graph `validationToken` **HTTP 404**
- **Missing Fly secrets:** `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` (+ GoTrue Azure on `aria-mantu-auth`)
- **Deploy confirm:** unset — after tip push, re-run `bash scripts/print-fly-deploy-confirm.sh` (SHA must match HEAD)
- **Waiter:** tmux `fly-wait-entra` polling drop-zones
- **Local gate:** `npx tsc --noEmit && npm test` green; audit **45/45**

## Done this shift

- Hard-reload gate fix: loading phase paints Sidebar+TopBar (no full-page "Loading demo workspace" card); demo hydrate skips loading; mount uses `useLayoutEffect`
- Local verify: hard reload shows shell first (`/opt/cursor/artifacts/hard-reload-shell-first-paint-fix.mp4`)
- Prior demo UX 5/5 + screenshots still valid

## Blockers

- Owner must supply `ARIA_PROD_DEPLOY_CONFIRM` encoding **new tip HEAD** after this push (never invent)
- Microsoft Graph secrets still missing for Outlook connect / full E2E

## Next steps

1. Owner: `bash scripts/print-fly-deploy-confirm.sh` → set `ARIA_PROD_DEPLOY_CONFIRM` (Cursor secret or `/tmp/owner-deploy-confirm.env`)
2. On confirm: `export FLY_API_TOKEN="$(tr -d '\n\r ' < production-readiness/.fly-token.env)" && bash scripts/fly-enterprise-golive-when-ready.sh`
3. Probe: ready `ok` + `build==tip` + mig `>=0066` + Graph validationToken **200**
4. Apply Microsoft secrets → Connect Outlook → `eval "$(bash scripts/print-fly-e2e-env.sh --export)" && bash e2e-workflow-test.sh`
5. Goal complete **only** when tip live + Graph200 + e2e PASS

## Decisions made (don't relitigate)

- PR **#32** is the deliverable (supersedes closed #29–#31)
- Fly-only for enterprise; Vercel CI red/rate-limit ignore
- Never invent `ARIA_PROD_DEPLOY_CONFIRM` or Azure secrets
- LinkedIn send stays 409 assisted-manual; calendar live book only via `/api/calendar/event` + `confirmLive`
- Graph seat `mode=live` only after inbound route + active Graph subscription
- Migration floor `>= 0066`; Mantu Fly `AGENT_FRAMEWORKS_REQUIRED=false`
- GDPR hold stays; Approve is always a separate second click
- Force dry-run with 0 connected outbound providers
- Loading phase may show shell chrome; product children stay blocked until ready
- Local `tsc` + `npm test` is CI authority while Actions budget exhausted

## Watch out

- Confirm SHA must equal clean-tree HEAD after tip commit
- Ignore stale env `ARIA_RELEASE_SHA=591a813…`; scripts force tip
- Do not click Approve/send real outreach on live Fly until dry-run confirmed
- FLY token: full `production-readiness/.fly-token.env` via `tr -d '\n\r '`, not fo1-only fragment
