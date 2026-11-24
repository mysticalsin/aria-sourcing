# WhatsApp human-review enforcement evidence

Date: 2026-07-09
Status: implementation slice completed in the shared worktree, but not release-verifiable after concurrent WhatsApp adapter changes introduced a separate TypeScript error.

## Safety change

- Autopilot now only classifies and drafts. It always returns `queue` with `human-review-required`.
- The WhatsApp webhook stores generated replies as `blocked` for human review and no longer writes an approval row.
- Migration `0008_human_outbound_approvals.sql` marks pre-provenance approvals `legacy_unverified` and accepts only `human` or `legacy_unverified` sources.
- The authenticated approval endpoint records `approval_source: "human"`.
- The immediate send route and scheduled dispatcher reject an approval whose source is not `human` before a claim or provider call.

## TDD evidence

RED before production change:

```text
autopilot: 31 passed, 3 failed
dispatch-outbound: 21 passed, 3 failed
outreach-guardrails: 13 passed, 2 failed
```

GREEN after production change:

```text
RESULT autopilot: 34 passed, 0 failed
RESULT dispatch-outbound: 24 passed, 0 failed
RESULT outreach-guardrails: 15 passed, 0 failed
```

`npm test` also passed at that point, including the updated suites.

## Current verification blocker

Another writer changed `src/lib/channels.ts`, `src/lib/whatsapp-policy.ts`, `tests/channels.mts`, and `tests/gate.mts` during verification. No audit subagent made those changes. The current build/typecheck failure is:

```text
src/lib/channels.ts(84,78): error TS2339: Property 'body' does not exist on type 'WhatsAppSendRequest'.
Property 'body' does not exist on type 'WhatsAppTemplateSendRequest'.
```

The error comes from the concurrently added template-message union, not the human-review enforcement files. It must be resolved by its author or explicitly handed over before a clean production build can be claimed.

## Known release blockers not solved by this slice

1. Explicit WhatsApp consent receipts, withdrawal records, phone suppression, and STOP handling are not yet enforced in the database.
2. The provider-approved template catalog, language/version controls, and server-side 24-hour session proof are not integrated with the send or dispatcher paths.
3. Current RLS permits direct writable outbound/inbound and approval records in ways that need a service-only delivery claim and role-bound approval RPC.
4. Migration 0008 has not been applied to a disposable or target Supabase database.
5. The employment-facing AI system needs DPO and Legal review, a DPIA/FRIA, and the broader high-risk deployment gate before production use.

## Next safe action

Resolve the template union type error without replacing the concurrent changes, then build a single server-authoritative WhatsApp delivery-control migration and RPC with real Supabase RLS integration tests.
