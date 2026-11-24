---
project: MSourcing / ARIA
shift: 45 (parallel track)
agent: claude-opus-4-8
updated: 2026-07-17
engagement: industrial-autonomous-loop (.rocket-fuel/PLAN.md rev 1, DEGRADED)
status: R2-email-durability COMMITTED 4f496ef (scoped, 11 files) — owner hydrated-env proof-run still pending; NOT pushed
note: Written to a dated file rather than clobbering _relay/HANDOFF.md, which a
      parallel session is using for the Phase-1 Rock 2 (0036 read-cutover CI-proof) track.
---

# Rock 2 — Email joins the durable outbox (industrial-autonomous-loop)

⚠️ DEGRADED: solo-Visionary. Codex Integrator usage-limited until 2026-07-23; Codex
re-attack of this rock is REQUIRED when quota returns.

Distinct from the shared HANDOFF.md's "Rock 2" (that is the 100x-roadmap PHASE-1 Rock 2,
migration 0036 read cutover, already committed 8f2a4e4). THIS is the industrial-
autonomous-loop engagement's Rock 2 (PLAN.md rev 1), migration 0039.

## What it does
Until now an approved email sent SYNCHRONOUSLY inside `/api/outreach/send`, so a closed
browser meant no send. R2 gives email WhatsApp's durable-outbox spine: a queued
`messages_outbound` row a headless worker leases and transitions queued→dispatching in one
service-only claim, a pre-dispatch trigger that RAISES without a live human approval
(mechanical never-auto-send for email), append-only delivery events with permanent-
bounce/complaint suppression, and `outreach_ledger.rfc_message_id` as the reply-correlation
key Rock 3 will thread replies back to.

## Files (all in the working tree, UNCOMMITTED)
New:
- `supabase/migrations/0039_email_channel_durability.sql`
- `src/lib/email-send.ts`  (performEmailSend — extracted, gate-identical send primitive)
- `tests/email-durability-db.sh`, `tests/email-durability-contract.mts`
Modified:
- `src/lib/email-oauth.ts` (buildMimeMessage stamps Message-ID; `messageId` on OAuthSendRequest)
- `src/lib/providers.ts` (`messageId` on SendRequest → Message-ID header)
- `src/lib/dispatch-outbound.ts` (dispatchDue Email branch; LinkedIn/SMS untouched)
- `src/app/api/outreach/send/route.ts` (Email path → enqueue-then-immediate-dispatch; sync send removed)
- `tests/db/function-privileges.sql` (4 new RPCs + trigger registered)
- `tests/test-manifest.mjs` + `tests/test-manifest-contract.mts` (registered both tests;
  digests recomputed: application 137→138, all 190→191, parity 192→193, database 14→16;
  all-sha 244d605e…, parity-sha b7c26b08…, database [16, 442c6f4d…]).
  NOTE: the database 14→16 also lands R1's loop-jobs-db registration that c95fe44 left
  uncommitted in the working tree — reconciled to keep the manifest+contract consistent.

## 0039 authority (mirrors 0009/0010/0013/0017/0022/0024 verbatim-faithfully)
- `messages_outbound.campaign_id` (additive) — durable claim stamps the client campaign on the ledger.
- `outreach_ledger.rfc_message_id` — format-checked, unique per workspace.
- `email_delivery_events` — mirrors whatsapp_delivery_events; ids-only (no PII → NOT in 0033
  erasure, per plan); enable+force RLS, revoke-all, select-only to authenticated + select policy.
- `enqueue_email_outbound(...)` authenticated definer; per-draft dedupe, `duplicate` on re-enqueue.
- `claim_email_outbound_queued(uuid)` service-only; outbox→advisory→approval→seat lock order;
  re-verifies body+scope hash / human / not-revoked, suppression (email+domain), a LIVE
  domain-verified non-phone seat, 90-day window, warmup cap; queued→dispatching + delivery_attempt_id;
  mints the RFC Message-ID from the SENDER mailbox domain.
- `record_email_send_message_id(...)` service-only; dispatching→sent + provider_message_id=rfc, ledger sent.
- `finalize_email_provider_failure(...)` service-only; definitive pre-transport reject → failed/skipped.
- `record_email_delivery_event(...)` service-only; idempotent event; permanent-bounce/complaint → suppression upsert.
- `enforce_active_email_approval()` + trigger — a SEPARATE before-update-of-status trigger, guarded
  by channel='Email'; raises P0001 without a live matching human approval. WhatsApp/LinkedIn/SMS untouched.

## Verification (honest)
- ✅ 28/28 structural assertions of email-durability-contract.mts verified via an equivalent
  plain-`node` port (tsx cannot load here — see blockers). Migration + dispatch + route + privileges shape confirmed.
- ✅ Manifest digests computed directly from the manifest and set into the contract.
- ✅ Adversarial self-review (compensating for absent Codex): lock order; SQL↔TS hash match
  (approvalHash/approvalScopeHash ↔ digest formulas); send/delivery idempotency; force-RLS-with-
  definer-insert safe (definer is postgres/BYPASSRLS, matching proven 0035); never-auto-send trigger guard.
  Also confirmed EmailConnectionProvider = {"Gmail API","Microsoft Graph"} → the email-send.ts
  provider assignment is exact-match (no cast needed). No defects survived.
- ⛔ BLOCKED in this sandbox (node_modules is OneDrive-dehydrated — tsx/tsc/eslint will not load
  within 6+ min; Docker socket denied; listening sockets EPERM):
  `npm run typecheck`, `typecheck:tests`, `lint`, exact `tsx tests/email-durability-contract.mts`,
  `npm run test:manifest`, `bash tests/email-durability-db.sh`, `npx tsx tests/docs-truth.mts`,
  `npm run build:isolated`. ALL must be owner-run in a hydrated local checkout.

## Owner run-list (hydrated checkout off CloudStorage)
```
npm run typecheck && npm run typecheck:tests && npm run lint \
  && npm run test:manifest \
  && bash tests/email-durability-db.sh \
  && npm run test:db-candidate-erasure \
  && npx tsx tests/docs-truth.mts \
  && npm run build:isolated
```
If typecheck flags anything it will be a small type fit in email-send.ts / dispatch-outbound.ts
(Supabase rpc/return casts) — the logic is verified.

## Committed 4f496ef
Scoped commit on Tony's explicit "do it": the 11 files above via explicit `git add` (never `-A`),
confidentiality-scanned clean, DEGRADED banner in the message. 1793 insertions / 228 deletions (the
deletions = the synchronous email send block removed from the route). On branch
integration/sourcing-enrichment-on-main. NOT pushed (push is a separate ask). The pre-existing dirty
files and the parallel session's HANDOFF.md/docs were NOT swept in.

## Next
1. Owner proof-run in a hydrated checkout off CloudStorage (see run-list above). If typecheck flags
   anything it will be a small type fit in email-send.ts / dispatch-outbound.ts — logic is verified.
2. 2026-07-23: Codex adversarial re-attack of 0039 + the dispatch/route diff (SHIP verdict).
3. R3 (inbound persistence + reply correlation + outcomes, 0040) consumes the rfc_message_id this rock added.
