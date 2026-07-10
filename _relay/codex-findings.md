# Codex audit findings

Codex writes findings here as it audits the codebase. Claude Code triages
every `open` entry at the start of each session/loop iteration. See
`AGENTS.md` for the full protocol.

## Template

```markdown
## <date> — <short title>
**Severity:** correctness | security | spec-mismatch | test-gap
**File:** path:line
**Issue:** what's wrong, concretely — not "could be cleaner"
**Repro/evidence:** the input/state that breaks, or the spec line violated
**Suggested fix:** optional, one line
**Status:** open | fixed (commit hash) | wontfix (reason)
```

No findings logged yet.

## 2026-07-09 — Late inactive-sender opt-out was discarded
**Severity:** correctness
**File:** src/app/api/webhooks/whatsapp/route.ts
**Issue:** The webhook skipped every inbound message whenever a registered sender was paused or revoked, including signed STOP requests.
**Repro/evidence:** A candidate sends STOP after an operator pauses the sender. The prior status guard ran before the inbound row, contact opt-out, and phone suppression writes.
**Suggested fix:** Persist all known-sender inbound events; route only inactive-sender opt-outs through the deterministic processor and mark other late text non-recoverable.
**Status:** fixed (uncommitted, targeted tests and disposable database verification passed)

## 2026-07-09 — Receipt RPC false outcome was acknowledged as durable
**Severity:** correctness
**File:** src/app/api/webhooks/whatsapp/route.ts
**Issue:** The webhook used only the RPC transport error, so `{recorded:false, reason:'outbound-not-found'}` was acknowledged as if a delivery event had been persisted.
**Repro/evidence:** A provider receipt arriving before `record_whatsapp_provider_acceptance` commits cannot find `provider_message_id`; the old route returned 200 because the RPC itself succeeded.
**Suggested fix:** Classify explicit unknown receipts separately from a same-sender dispatching acceptance race and return 503 for the latter.
**Status:** fixed (uncommitted, migration 0015 and direct SQL outcome probe passed)

## 2026-07-09 — Approved WhatsApp review draft could become orphaned
**Severity:** correctness
**File:** src/lib/dispatch-outbound.ts
**Issue:** A previously approved WhatsApp candidate reply re-blocked by a later transient policy check retained `review_decision='approved'`, which the review RPC refuses to review again.
**Repro/evidence:** A queued approved reply hits a temporary missing-contact policy block, transitions to blocked, then fails the `review_decision is null` review eligibility check.
**Suggested fix:** Reset only approved candidate-reply review metadata whenever dispatcher policy returns it to blocked.
**Status:** fixed (uncommitted, dispatcher regression test passed)

## 2026-07-09 — Inbound recovery could starve mapped messages
**Severity:** correctness
**File:** src/lib/whatsapp-inbound.ts
**Issue:** Recovery applied its limit before excluding rows with no WhatsApp sender mapping, allowing unmapped rows to consume the bounded batch.
**Repro/evidence:** A workspace with enough legacy unmapped inbound rows could repeatedly skip its limit and never reach recoverable rows.
**Suggested fix:** Filter `whatsapp_sender_id IS NOT NULL` in the query before the limit.
**Status:** fixed (uncommitted, regression test passed)

## 2026-07-09 — Any generated-draft duplicate was treated as idempotent
**Severity:** correctness
**File:** src/lib/whatsapp-inbound.ts
**Issue:** A `23505` on review-draft insert was treated as success without proving the existing row belonged to the same inbound event.
**Repro/evidence:** Two messages yielding the same dedupe hash could mark the second inbound processed without a visible review draft.
**Suggested fix:** Accept idempotency only for a matching `inbound_message_id`; retain all other collisions as durable triage.
**Status:** fixed (uncommitted, regression test and SQL triage-retention probe passed)
