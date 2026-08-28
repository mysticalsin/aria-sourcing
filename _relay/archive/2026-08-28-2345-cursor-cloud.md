---
project: MSourcing / ARIA
shift: 312
agent: cursor-cloud
updated: 2026-08-28T23:35Z
status: confirm-safety-append-booking-failover
---

# Handoff — Shift 312

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft
- **Tip:** `b8c167d` · Live Fly `fc8b54a` / **0071** (tip adds **0072**)
- **Audit:** expect **64/64** after gate · **Gate:** green · audit **64/64**
- **M365:** `fly_m365_missing=7` · watcher + reprobe timer
- **LLM:** `llm_auth=dead` · `/tmp/owner-llm.env` absent
- **Goal:** strict E2E PASS blocked on owner secrets

## Done this shift

1. `confirm-calendar-book` mirrors `/api/calendar/event`: replay claimed→502; only reconcile `failed` on `deliveryState=not-sent`
2. Hermes `tryLoopTaskCloudFailover` works without workspaceId; failover on retryable/network errors
3. Migration **0072** `append_booking` + worker appends to `state.bookings` after live Teams confirm (distinct receipt keys)
4. `AGENT_PROVIDER` auto from probe `FIRST_LIVE_PROVIDER` → `/tmp/aria-e2e-agent-provider` → print-fly-e2e-env / e2e

## Blockers

Owner: 7 M365 + live LLM remint + deploy confirm → Connect Outlook (Teams meetings) → Graph webhook → strict E2E

## Next steps

```bash
bash scripts/print-fly-golive-status.sh
bash scripts/probe-m365-unblock.sh --apply
bash scripts/fly-apply-owner-llm-secrets.sh
bash scripts/probe-fly-llm-auth.sh
# expect RESULT: llm_auth_ok + FIRST_LIVE_PROVIDER=…
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
- Calendar Agenda needs state.bookings via append_booking (not only candidate.booking)

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show”
- Deploy tip needs migration **0072** applied on Fly before loop append_booking works live
