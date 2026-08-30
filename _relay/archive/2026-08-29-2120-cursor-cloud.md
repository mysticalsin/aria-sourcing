---
project: MSourcing / ARIA
shift: 399
agent: cursor-cloud
updated: 2026-08-29T21:20Z
status: rei-wa-inbound-autopilot-retry
---

# Handoff — Shift 399

## Current state

- **Branch / PR:** `cursor/rei-autopilot-send-b91d` → **PR #39**
- **This shift:** WhatsApp inbound replies Autopilot-queue when entitled+Sequences+eligible; draft_generate retries on autopilot 5xx/unreachable
- **Live Fly:** `1665b39` / **0074**; **0076 not applied**; Graph dropzones absent → **HOLD**

## Done this shift

1. `whatsapp-inbound.ts` — load arming, mint `autopilot_critics`, queue+dispatchDue; else blocked review
2. Worker — `HandlerError` retryable on autopilot 5xx / unreachable / result error
3. Tests: whatsapp-inbound-autopilot contract, draft 5xx retry; STATUS/webhook honesty

## Blockers

1. Deploy tip + **0076**
2. Settings HeyReach + live seat; entitle; arm Sequences
3. Graph dropzones empty — strict PASS HOLD

## Next steps

```bash
bash scripts/print-fly-deploy-confirm.sh && bash scripts/fly-deploy-now.sh
# Settings → HeyReach; entitle; arm Sequences
bash scripts/run-enterprise-e2e-partial.sh
```

## Decisions made (don't relitigate)

- Settings vault + campaign first-class
- Autopilot fail-closed: ready + criticsPassed
- WA cold first-touch: template or open window; WA inbound reply: Autopilot may queue
- Live book + WA inbound queue require Autopilot + Sequences
- Stable draft ids; retry autopilot send on transient failure
- HOLD when Microsoft dropzones empty

## Watch out

- WA inbound still needs agent-spec `guardrails.autopilot: true` for auto_approve_eligible
- mint requires 0076 on prod
