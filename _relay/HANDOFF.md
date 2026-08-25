---
project: MSourcing / ARIA
shift: 68
agent: cursor-cloud
updated: 2026-08-25 UTC
status: inbound-reply-webhook-autopilot-wired
---

# Handoff - Shift 68

## Current state

- Branch `cursor/enterprise-autopilot-b91d` → PR #25. Event-driven candidate-reply path shipped.
- `POST /api/webhooks/email-inbound` now enqueues `inbound_classify` for **new** inbounds only (duplicates skip → no re-bill).
- Loop `handleInboundClassify`: LLM only on claimed jobs; positive intent + entitled profile → `draft_generate` successor (sends still approval-gated).
- Idle ticks still do **not** poll mailboxes or call the classifier.
- Docs: `docs/INBOUND_REPLY_AUTOPILOT.md`; Settings → Observability shows Reply webhook panel.

## Done this shift

- `src/lib/inbound-reply-trigger.ts` + webhook enqueue wiring.
- Worker draft successor for INTERESTED / QUALIFIED_INTEREST.
- Tests: inbound-reply-trigger, email-inbound-contract pins, sourcing-loop-worker entitled draft path.
- Env examples: `EMAIL_INBOUND_WEBHOOK_SECRET`.

## Blockers

- CI-BUDGET (Tony).
- A-1: kill-switch flip after P-1/P-2.
- Live: set webhook secret, mailbox routes, provider → POST adapter.

## Next steps

1. Ops: configure `EMAIL_INBOUND_WEBHOOK_SECRET` + `inbound_mailbox_routes` + provider inbound URL.
2. After DB proofs: `kill_switch=false`, `intake_enabled=true`, entitle operators, Fly loop live.
3. Optional: Graph change-notification adapter that forwards into email-inbound (same HMAC shape).

## Decisions made (don't relitigate)

- Webhook-first replies; no idle classify.
- Positive reply → draft follow-up for entitled autopilot; not silent re-source.
- LinkedIn inbound remains send-only until vendor webhook (L-5).

## Watch out

- Enqueue returns `control_blocked` when switchboard off — mail is still stored; flip controls then replay/retry.
- WhatsApp path already webhook-driven; email is now parity for enqueue-on-answer.
