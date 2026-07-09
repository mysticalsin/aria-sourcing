---
project: MSourcing / ARIA
date: 2026-07-09
status: code-complete-not-deployed
scope: whatsapp-delivery-policy
---

# WhatsApp delivery-policy hardening

## Implemented in this worktree

- Added `supabase/migrations/0009_whatsapp_delivery_policy.sql`.
  - Phone do-not-contact entries use canonical E.164 digits.
  - Consent, registered senders, approved templates, reply windows, and content-gate cache records are durable workspace data.
  - Existing WhatsApp records are not inferred or backfilled as consented.
  - `claim_whatsapp_outbound(message_id)` is service-role-only. It locks the outbox row, validates human approval, consent, phone suppression, sender, template or reply window, seat, recontact interval, daily cap, and creates the ledger claim before changing a message to `dispatching`.
- The outbox dispatcher now re-runs the human-likeness gate at the wire, persists a verdict cache, refuses cache failures, requires a trusted template catalogue record for template sends, and calls the WhatsApp-specific atomic RPC.
- The Meta adapter now emits a typed template payload for `approved_template`; a text payload is used only for a candidate reply that cleared the current window policy.
- `/api/outreach/send` no longer calls the WhatsApp adapter. It queues an approved message, then may immediately dispatch only that exact outbox record. The response distinguishes `sent`, `queued`, `skipped`, and `error`.
- The UI keeps a queued WhatsApp send as queued. It does not report it as delivered.
- Webhooks resolve the ARIA workspace from Meta `phone_number_id`, not an environment workspace value. A deterministic opt-out command is processed before any thread lookup or model call: consent is revoked, a phone suppression record is added, queued messages are blocked, and no draft is generated.
- Candidate-facing copy is checked before queueing and again before the provider call. The cache stores only a hash and verdict; it never authorizes delivery by itself.

## Verification completed locally

```text
npx tsc --noEmit                                  PASS
npx tsx tests/gate.mts                            105 passed, 0 failed
npx tsx tests/channels.mts                        26 passed, 0 failed
npx tsx tests/autopilot.mts                       40 passed, 0 failed
npx tsx tests/dispatch-outbound.mts               36 passed, 0 failed
npx tsx tests/outreach-guardrails.mts             19 passed, 0 failed
git diff --check                                  PASS
```

The dispatcher test deliberately injects a cache-store failure and logs it. The expected result is a blocked message with no claim and no provider call.

## Deployment order

1. Apply migrations through `0009` to staging while outbound WhatsApp delivery is disabled.
2. Insert one active `whatsapp_senders` row per Meta `phone_number_id`, mapping it to its ARIA workspace and live WhatsApp seat.
3. Import only documented opt-ins into `whatsapp_contacts`. Do not infer consent from historical inbound records.
4. Sync Meta-approved templates into `whatsapp_templates`, including sender, locale, version, and body parameter count.
5. Configure production Meta credentials and signed webhook delivery, then replay signed sandbox events for inbound text, STOP, duplicate event, stale freeform reply, approved template, and provider error.
6. Run the full test suite and a production build in CI or a non-OneDrive checkout. Verify the deployed commit and migration IDs before enabling the first sender.
7. Enable one sender with a small monitored canary. Inspect the outbox, ledger, and Meta delivery status after every dispatch.

## Known external blockers

- The Supabase migration has not been applied in this workspace. `npx supabase db lint --local` could not connect because the local Docker daemon is not running.
- No Meta production sender, approved template catalogue, verified opt-in import, or deployed webhook evidence is available locally.
- The repository's Next build has previously stalled on the OneDrive Files On-Demand checkout. Build proof must come from CI, Vercel, or a fully local clone.

## Invariant to preserve

No source, agent, Flowise flow, webhook, UI route, or worker may call Meta directly. The only allowed provider path is:

`approved message -> messages_outbound -> dispatcher -> claim_whatsapp_outbound -> typed Meta adapter`

Any failure before the adapter must leave the message blocked, failed, or queued and must never produce a candidate-visible process update.
