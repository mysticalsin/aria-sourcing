---
project: MSourcing / ARIA
shift: 297
agent: cursor-cloud
updated: 2026-08-28T20:20Z
status: post-booking-stage-honesty
---

# Handoff — Shift 297

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft
- **Live Fly:** `fc8b54a` / **0071** · tip pending remint
- **Audit:** **64/64** · **Gate:** green
- **M365:** `fly_m365_missing=7` · watcher armed
- **LLM:** `kimi=auth_dead` · `/tmp/owner-llm.env` absent
- **Goal:** strict E2E PASS blocked on owner secrets + Connect Outlook + webhook

## Done this shift

1. `createBookingFor` only promotes stage → Booked when meeting URL exists
2. Win record append gated on confirmed calendar (Teams/calendar link)
3. Activity notes: "Stage stays Interested — Needs calendar before Booked"
4. `updateBooking` Completed works from Interested+local slot
5. Campaign Booked hint: "With Teams/calendar link"

## Blockers

Owner: 7 M365 secrets + LLM key + remint deploy confirm → Connect Outlook → strict E2E

## Next steps

```bash
bash scripts/probe-m365-unblock.sh --apply   # when /tmp/owner-microsoft.env lands
bash scripts/fly-apply-owner-llm-secrets.sh
bash scripts/probe-fly-llm-auth.sh
bash scripts/print-fly-deploy-confirm.sh
bash scripts/fly-enterprise-golive-when-ready.sh
bash scripts/verify-m365-ready.sh
env -u ARIA_ALLOW_PARTIAL_M365_E2E -u ARIA_ALLOW_PARTIAL_LLM_E2E bash e2e-workflow-test.sh
```

## Decisions made (don't relitigate)

- Production = Fly only; ignore Vercel/GHA
- PR #36 only; goal until strict Fly PASS
- Booked stage + booked KPI require meeting URL

## Watch out

- GHA empty-steps + Vercel rate limit — ignore
