---
project: MSourcing / ARIA
shift: 264
agent: cursor-cloud
updated: 2026-08-28T10:05Z
status: honesty-fixes-committed-m365-still-blocked
---

# Handoff — Shift 264

## Current state

- **Branch tip:** post-honesty commit (OAuth scope honesty + calendar Teams preflight + E2E PARTIAL honesty)
- **Live Fly tip (pre-remint):** `2abdef2` · migration **0071** — remint after this shift's tip if confirm refreshed
- **PR:** [#35](https://github.com/mysticalsin/aria-sourcing/pull/35)
- **Gate:** `npx tsc --noEmit && npm test` green (audit **59/59**; calendar-booking-authority 61 pass)
- **Canonical Entra tenant:** `ce57ebe3-a63d-4708-b5cf-c274b48bd26c` (Mantu Group Sandbox)
- **M365 secrets still missing (7)** — az scan still zero aria-mantu redirect apps; noperm marker present
- **Watcher:** tmux `watch-owner-microsoft` running

## Done this shift

1. OAuth callback no longer invents Graph scopes when `tokenJson.scope` omitted
2. Calendar Graph create preflights Calendars.ReadWrite + OnlineMeetings.ReadWrite
3. Settings step 4 complete only when `webhookIntakeReady`
4. Login surfaces Microsoft OAuth error message
5. E2E: live Entra CTA when GoTrue Azure secrets present; OnlineMeetings scope gate before 6b; PARTIAL when skip flags set
6. Allowlisted `fly-remint-app-only.sh` in infra-release-contract; guard before credentials
7. Audit matrix updated for authorize scopes + no invented callback scopes

## Blockers

1. **Owner** must create Entra app in Mantu Sandbox + set 7 Fly secrets (see `_relay/M365-OWNER-UNBLOCK.md`)

## Next steps

1. Remint tip so honesty fixes are live (`bash scripts/print-fly-deploy-confirm.sh` → refresh `/tmp/owner-deploy-confirm.env` → `bash scripts/fly-remint-app-only.sh`)
2. Owner: `bash scripts/print-m365-owner-portal-checklist.sh` → create app → apply secrets → Connect Outlook → Enable webhook
3. `bash scripts/verify-m365-ready.sh` → RESULT: PASS (incl. 6b Teams joinUrl)
4. Loop kill switch only after full PASS

## Decisions made (don't relitigate)

- **Production = Fly only**
- Entra tenant for Fly Mantu = **ce57ebe3…** (Mantu Group Sandbox)
- Graph OAuth tenant authority + OnlineMeetings.ReadWrite
- Never invent OAuth scopes in callback; fail closed on missing calendar/Teams scopes at create time

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
ARIA_ALLOW_PARTIAL_M365_E2E=1 bash e2e-workflow-test.sh
# expect RESULT: PARTIAL; never pretends full PASS while 6b skipped
bash scripts/post-m365-secrets-golive.sh
bash scripts/verify-m365-ready.sh
```
