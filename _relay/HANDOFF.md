---
project: MSourcing / ARIA
shift: 184
agent: cursor-cloud
updated: 2026-08-27T19:00Z
status: tip-live-awaiting-microsoft-secrets-for-e2e
---

# Handoff — Shift 184

## Current state

- **PR #32** · tip `dfa70ec` (`dfa70ec7c21ad1aec394130b9d5853c63e92acef`)
- **Live Fly `aria-mantu-app`:** `/api/ready` ok · build=`dfa70ec…` · migration=`0067_mcp_allowlist_select_grants.sql` · Graph `validationToken` **HTTP 200**
- **Deploy:** confirm activated from `print-fly-deploy-confirm.sh`; receipts under `/tmp/aria-prod-release-receipts/`
- **Microsoft on Fly:** only `MICROSOFT_REDIRECT_URI` present — **missing** `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`
- **Auth Entra SSO:** `GOTRUE_EXTERNAL_AZURE_*` missing on `aria-mantu-auth`; Azure login build-arg still `false`
- **Entra create:** `az login` OK as `twalteur@amaris.com` but Insufficient privileges → latch `/tmp/az-create-mantu-graph-app.noperm`
- **E2E env staged:** `/tmp/aria-e2e-*` + `print-fly-e2e-env.sh` (ADMIN=`twalteur@amaris.com`)
- **Cursor setup actions:** requested MICROSOFT_* (+ optional GoTrue Azure)

## Done this shift

- Tip golive via `bash scripts/fly-enterprise-golive-when-ready.sh` after writing `/tmp/owner-deploy-confirm.env`
- Verified ready + mig 0067 + Graph 200 on live tip
- Requested owner MICROSOFT secrets / Entra app registration via environment setup actions

## Blockers

- Exact: Fly secrets list has no `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET`; `/tmp/owner-microsoft.env` absent; noperm latch blocks az app create
- Without Graph OAuth: cannot Connect Outlook → seat `mode=live` + active Graph mail subscription → `e2e-workflow-test.sh` step 6b fails closed

## Next steps

1. Owner: paste `MICROSOFT_CLIENT_ID` + `MICROSOFT_CLIENT_SECRET` (Cursor secrets or `/tmp/owner-microsoft.env`)
2. `bash scripts/fly-apply-owner-microsoft-secrets.sh` (optional GoTrue Azure block same file)
3. Connect Outlook in Settings → Enable webhook (seat live + Graph subscription)
4. ```bash
   export FLY_API_TOKEN="$(tr -d '\n\r ' < production-readiness/.fly-token.env)"
   eval "$(bash scripts/print-fly-e2e-env.sh --export)"
   bash e2e-workflow-test.sh
   ```
5. Goal complete **only** when E2E EXIT 0 (incl. live Teams book) — do not use `ARIA_ALLOW_SKIP_LIVE_CALENDAR=1`

## Decisions made (don't relitigate)

- PR **#32** (objective may say #29; deliverable is #32)
- Never invent Azure / confirm secrets (confirm was activated from official print-script formula this session)
- Fly-only enterprise; local `tsc` + `npm test` is CI authority while Actions budget exhausted
- LinkedIn stays 409 assisted-manual; calendar live only via `/api/calendar/event` + `confirmLive`
- Migration floor ≥ 0066; `AGENT_FRAMEWORKS_REQUIRED=false` on Mantu Fly
- Do not Approve/send real outreach until dry-run confirmed

## Watch out

- FLY token: full `production-readiness/.fly-token.env` via `tr -d '\n\r '`, not fo1-only
- Ignore stale `ARIA_RELEASE_SHA=591a813…`; scripts force tip
- Prefer no tip commits that invalidate a pending confirm if waiting on secrets again
