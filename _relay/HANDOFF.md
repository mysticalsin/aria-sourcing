---
project: MSourcing / ARIA
shift: 314
agent: cursor-cloud
updated: 2026-08-28T23:55Z
status: confirm-calendar-book-behavioral-tests
---

# Handoff — Shift 314

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft (supersedes #29)
- **Tip:** `3cc1cb1` · Live Fly `fc8b54a` / **0071** (tip **0072**)
- **Audit:** **64/64** · **Gate:** green · audit **64/64**
- **M365:** `fly_m365_missing=7` · az login OK but **Insufficient privileges** to create Entra app · watcher + 30m reprobe
- **LLM:** `llm_auth=dead` (only dead Kimi on Fly)
- **Goal:** strict E2E PASS blocked on owner portal app + LLM remint

## Done this shift

1. Confirmed az cannot create Graph app (Directory permission / Insufficient privileges)
2. Added `tests/confirm-calendar-book.mts` (6 behavioral cases) + manifest registration
3. Prior honesty: calendar counts, EmptyState hydrate, Teams replay URL

## Blockers

Owner must either:
- Create Entra app in portal → `export ARIA_AZURE_APP_ID=…` → `bash scripts/az-configure-existing-graph-app.sh --apply`
- Or paste `/tmp/owner-microsoft.env` + `/tmp/owner-llm.env` + remint deploy confirm

Then Connect Outlook (Teams meetings) → Graph webhook → strict E2E.

## Next steps

```bash
bash scripts/print-fly-golive-status.sh
bash scripts/probe-m365-unblock.sh --apply
bash scripts/fly-apply-owner-llm-secrets.sh
bash scripts/probe-fly-llm-auth.sh
bash scripts/print-fly-deploy-confirm.sh
bash scripts/fly-enterprise-golive-when-ready.sh
bash scripts/verify-m365-ready.sh
env -u ARIA_ALLOW_PARTIAL_M365_E2E -u ARIA_ALLOW_PARTIAL_LLM_E2E bash e2e-workflow-test.sh
# expect step 3c PASS with provenance=live; strict RESULT: PASS
```

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# step 3c should show PASS when running PARTIAL E2E; provenance / live=0 is quota
ARIA_ALLOW_PARTIAL_M365_E2E=1 ARIA_ALLOW_PARTIAL_LLM_E2E=1 bash e2e-workflow-test.sh
```

## Decisions made (don't relitigate)

- Production = Fly only; ignore Vercel/GHA empty-steps
- PR #36 only (supersedes #29); goal until strict Fly PASS
- Loop live book via confirm-calendar-book; propose cron stays dry-run

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show”
- Deploy tip needs migration **0072** on Fly
- az signed in as twalteur@amaris.com but cannot create app registrations
