---
project: MSourcing / ARIA
shift: 313
agent: cursor-cloud
updated: 2026-08-28T23:45Z
status: honesty-calendar-hydrate-confirm-replay
---

# Handoff — Shift 313

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft
- **Tip:** `cf6b0cc` · Live Fly `fc8b54a` / **0071** (tip **0072**)
- **Audit:** **64/64** · **Gate:** green · audit **64/64**
- **M365:** `fly_m365_missing=7` · watcher alive · 30m reprobe armed
- **LLM:** `llm_auth=dead`
- **Goal:** strict E2E PASS blocked on owner secrets

## Done this shift

1. Calendar badge counts only booked interviews (`!bookingNeedsCalendar`); Needs calendar count separate
2. InterviewerPanel load ignores Needs-calendar slots
3. Settings/Calendar/Outreach HydrationGate: EmptyState loading (no SkeletonCard collage)
4. confirm-calendar-book confirmed replay requires `isTeamsMeetingJoinUrl(meetingUrl)`

## Blockers

Owner: 7 M365 + live LLM remint + deploy confirm → Connect Outlook (Teams meetings) → Graph webhook → strict E2E

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
- Calendar Agenda needs state.bookings via append_booking (not only candidate.booking)

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show”
- Deploy tip needs migration **0072** applied on Fly before loop append_booking works live
