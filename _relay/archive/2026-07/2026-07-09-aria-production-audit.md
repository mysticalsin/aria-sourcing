---
project: MSourcing / ARIA
date: 2026-07-09
status: verified-code-not-live-production
scope: sourcing-agents-flowise-deerflow-whatsapp
---

# ARIA production audit and handoff

## Verified in the source repository

- `d703a2e` added a TypeScript-native, resumable sourcing-agent graph in `src/lib/agents/graph.ts`, an Agent Studio route, agent-spec persistence, a server-side Flowise proxy, the WhatsApp inbound webhook, a queued outbound dispatcher, and a final human-likeness gate.
- `src/lib/gate.ts` blocks AI self-disclosure, process/status narration, tool and JSON leakage, role prefixes, markup, and placeholders before queueing and again at the wire. `messages_outbound` adds a durable per-candidate/channel dedupe hash.
- WhatsApp inbound messages are signature-verified, stored idempotently, and default to a human queue. Automatic replies require agent-level opt-in, a re-armed five-message canary, a clean gate verdict, and an approval record. Commitments are queued for human review.
- Flowise is exposed only through an ARIA server-side proxy. The browser never receives the Flowise API key. Agent Studio opens a separately hosted workbench rather than embedding it in an iframe.
- Fresh local evidence: `npm run typecheck` and `npm run test` completed successfully after the Studio correction. The full test suite includes 94 human-likeness checks, 32 autopilot checks, 35 agent-graph checks, and 21 dispatcher checks.

## Correction made in this audit

`src/app/studio/page.tsx` had six UI API mismatches introduced with the Agent Studio feature:

- `useToast()` returns `{ toast }`, not methods such as `toast.error()`.
- `Switch` accepts `onCheckedChange`, not `onChange`.

The stale incremental TypeScript cache hid this locally. Removing the cache reproduced all six errors, then the source was changed to use the existing contracts. A clean typecheck and full test suite are green after the correction. This one-file correction is currently uncommitted and must be committed separately from other worktree changes.

## Architecture decision

ARIA is the control plane for identity, tenant isolation, candidate data, agent definitions, approved versions, policy, audits, and every outbound channel.

- DeerFlow is a source of agent-runtime patterns. Do not expose it directly to users or give it direct database, provider, or WhatsApp access. If adopted beyond the current TypeScript graph, use a private adapter with a narrow, versioned contract.
- Flowise is a private authoring and optional execution sidecar. It must not own ARIA tenancy, approval policy, or Meta credentials. Community Flowise requires single-tenant deployment or one isolated instance per tenant. Do not copy its UI or Enterprise paths without a license review.
- WhatsApp remains an ARIA-owned capability. Only typed candidate-message drafts may enter the durable outbound queue. Agent events, tool output, hidden reasoning, and execution status have no route to the provider.

## Production blockers

The application cannot truthfully be called live-production-ready until these are complete and evidenced:

1. Apply `supabase/migrations/0007_agent_runtime.sql` to the production project and run tenant-isolation, negative-RLS, idempotency, and recovery tests against that project.
2. Provision a private Flowise sidecar with PostgreSQL, Redis/queue mode, managed secret storage, a stable encryption key, an HTTP deny list, disabled unnecessary nodes, no browser API key, and an ARIA-only network path.
3. Configure Meta WhatsApp Business with a production sender, long-lived system-user token, approved templates, public HTTPS webhook, app subscription, verify token, app secret, and delivery-status webhooks.
4. Add and verify a phone-specific opt-out and consent record. The present suppression table only supports email, domain, and LinkedIn values, so a WhatsApp phone opt-out is not yet a server-side database invariant.
5. Enforce a typed outbound policy: free-form WhatsApp is allowed only inside a verified 24-hour reply window; business-initiated contact must use a Meta-approved template; no send proceeds without consent, ownership, frequency, DNC, and country-policy checks.
6. Add durable policy/idempotency evidence: an HMAC-keyed decision cache, transactional outbox identity, Meta message IDs, immutable delivery events, and invalidation on reply or opt-out webhooks.
7. Move the local build gate off OneDrive Files On-Demand. Both `next build` and `next build --webpack` stalled without CPU or active file reads while holding `.next/lock`. Verify the exact commit in CI/Vercel before release.
8. Push the local commit `a87fed7` before treating dispatcher test coverage as deployed. It was one commit ahead of the verified remote during this audit. The Studio correction from this audit is also uncommitted.

## Release truth

Code-level guardrails and tests are present. Live deployment, data migration, provider credentials, Meta approval, consent controls, sidecar hardening, and remote build proof are still required. Do not enable live WhatsApp sending until every blocker above has a recorded passing check.

## Update: WhatsApp delivery policy implemented, still not deployed

`0009_whatsapp_delivery_policy.sql` and its associated runtime changes now close the code-level gaps in production blocker items 4 through 6: phone DNC, explicit consent, sender-to-workspace mapping, approved templates, reply windows, content-gate verdict caching, typed provider payloads, and service-only claims are implemented in the worktree. The direct route now enters the durable outbox rather than calling Meta.

This does not change release truth. The migration, Meta sender/template configuration, opt-in import, signed webhook replay, staging database proof, and remote build proof remain mandatory. See `2026-07-09-whatsapp-delivery-hardening.md` for the exact rollout sequence and verification evidence.

## Update: local release verification now passes

The same checkout now passes `npx tsc --noEmit`, `npm run test`, `npm run build`, and `git diff --check`. The former local build stall did not reproduce. The browser sidecar was also changed to transparent, public, read-only research only, removing stealth, private-network access, text entry, and arbitrary page evaluation from its production tool vocabulary.

This is source-level verification only. The production deployment, migrations, external provider configuration, and signed webhook evidence remain release gates. See `2026-07-09-production-verification.md`.
