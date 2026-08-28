---
project: MSourcing / ARIA
shift: 262
agent: cursor-cloud
updated: 2026-08-28T09:50Z
status: tip-live-2abdef2-onlinemeetings-m365-owner-blocked
---

# Handoff — Shift 262

## Current state

- **Live Fly tip:** `2abdef2` · migration **0071** · `deploy_status=tip_live`
- **PR:** [#35](https://github.com/mysticalsin/aria-sourcing/pull/35) (supersedes closed #29–#33)
- Graph OAuth: tenant authority + **OnlineMeetings.ReadWrite** on authorize/refresh
- Post-secrets automation: `bash scripts/post-m365-secrets-golive.sh` (+ durable watcher)
- **M365 secrets still missing (7)** — owner Entra app + Fly secrets
- **PARTIAL E2E:** 48 pass / 0 fail / 1 warn (only **6b** Teams) — last proven on `02b077b`; tip reminted for OnlineMeetings
- expect step **3c PASS**; never pretends full PASS while 6b skipped

## Done this shift

1. Added OnlineMeetings.ReadWrite to OAuth + az delegated perms; Settings honesty updated
2. Added `post-m365-secrets-golive.sh`; wired `watch-owner-microsoft-and-apply.sh`
3. Reminted tip `2abdef2` live

## Blockers

1. **Owner M365-FLY-6** — Entra app + 7 Fly secrets

## Next steps

1. Owner: `/tmp/owner-microsoft.env` → watcher apply → Connect Outlook → `verify-m365-ready.sh`
2. Loop kill switch only after full PASS

## Decisions made (don't relitigate)

- **Production = Fly only**
- Graph OAuth tenant authority (not `/common/`)
- OnlineMeetings.ReadWrite requested for Teams joinUrl on confirmLive

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
bash scripts/print-fly-deploy-confirm.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# expect build 2abdef2…, migration 0071
ARIA_ALLOW_PARTIAL_M365_E2E=1 bash e2e-workflow-test.sh
# expect step 3c PASS; never pretends full PASS while 6b skipped
bash scripts/post-m365-secrets-golive.sh   # after owner secrets
bash scripts/verify-m365-ready.sh
```
