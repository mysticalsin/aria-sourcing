# Production Readiness Status

**Date:** 2026-08-28

This page describes source and release-gate status. It is not evidence that a
particular production deployment is healthy.

## Source candidate

- Node 22, Next.js 16, React 19, and TypeScript 5 are enforced by the repository.
- `npm test` executes the validated inventory in `tests/test-manifest.mjs`.
  Inspect the current ordered lifecycle with
  `node scripts/run-test-manifest.mjs --list all` instead of copying totals.
- Local acceptance requires typecheck, lint, the full test chain, the isolated
  production build, the exact database restart test, and the database authority
  test.
- Migrations through **0079** are in source: LinkedIn channel (`0054`), per-user
  autopilot entitlements + template-bound approvals (`0055`), MCP allowlist
  authority (`0056`), pre-call/first-interview loop kinds (`0069`), enqueue
  switchboard fix (`0070`), post-booking interview prep (`0071`), workspace
  revision-only loop reads (`0074`), Autopilot critics mint/enqueue (`0076`),
  HeyReach inbound routes (`0077`), post-0074 loop slice RPCs +
  `merge_outreach_message` (`0078`), and Autopilot enqueue body/scope hash bind
  (`0079`). Apply and prove on a Docker-enabled host
  before lighting the loop kill switch.
- Enterprise E2E audit matrix: [`_relay/e2e-audit-matrix.md`](../_relay/e2e-audit-matrix.md)
  (58/58 automated pins in `tests/enterprise-e2e-audit-matrix.mts`).
- The Fly release builds the application, database, bootstrap, Kong, and
  one-shot Graphify lesson-worker images for `linux/amd64`; pulls Auth and REST
  at their exact config-pinned upstream digests; schema-validates CycloneDX 1.7
  SBOMs and applies HIGH/CRITICAL plus secret gates to all 7 images; attests and
  promotes the 5 local builds; and verifies all 6 deployed service digests.
- Database recovery mounts the durable volume at `/var/lib/postgresql`, keeps the
  image data directory at `/var/lib/postgresql/data`, and refuses legacy or
  partial layouts rather than initializing an empty replacement.
- Privileged owner reconciliation runs only as direct `supabase_admin`.
  Application migrations run only as direct `postgres` without superuser or
  owner-role membership. Auth and REST use distinct runtime roles and passwords.
- Fly secret inventories are allowlisted and must be fully `Deployed` before
  mutation and again before receipt creation. Previous encryption keys use a
  key-ID ring; retiring a deployed ring requires exact release-bound owner
  approval.
- The 0032 application-surface fallback passes its disposable database test but
  is not production-executable. A protected apply job and append-only,
  ledger-safe forward migration are still required.
- Inbound candidate replies default to named human review (`blocked` / Needs
  Approval). When Autopilot is entitled and Sequences are armed, critics-green
  first-touch and eligible WhatsApp reply drafts may mint `autopilot_critics`
  and durable-queue; claim RPCs still re-validate authority at send time.
  Entitled users may reach `auto_approve_eligible` only when guardrails, salary
  disclosure, and injection checks all pass.
- After a live calendar booking (`confirmLive` + provider receipt),
  `interview_prep_send` drafts interviewer prep + candidate confirmation, runs
  live quality critics, and Autopilot-queues Email when entitled + Sequences
  armed; otherwise drafts stay Needs Approval for human Approve → Send.
- Agent graph drafts stay in exact-owner run history with no delivery authority.
  They do not create a review queue or provider outbox row.
- Email, WhatsApp, and LinkedIn claims share seat/capacity and recontact
  windows; ambiguous provider outcomes continue to reserve capacity.
- Agent memory is encrypted, owner/spec scoped, bounded, receipt-bound before
  any external key or model access, and legacy shared memory is hash-only
  quarantined rather than activated.
- Sourcing runs use campaign-owned role evidence, database quota and replay
  authority, query policy enforcement, and completion receipts. Candidate
  records are released only after the completion receipt is accepted.
- Graphify receives only aggregate query fingerprints and outcome counts in an
  isolated no-network worker. It has no runtime sourcing authority and cannot
  promote lessons; a separate admin review with independent evidence is required.
- Candidate erasure uses tenant-bound authority, local tombstones, non-final
  provider obligations, and transaction advisory locks for every normalized
  contact reimport path covered by migration 0033. This does not cover candidate
  data embedded in agent-run JSON, framework results, or encrypted agent memory
  (documented carve-out — P-10).
- Orphaned `Floor3DScene.tsx` removed (P-11); live floor uses `Floor3D.tsx` →
  `RetroOfficeScene`.
- Integration API map: [`docs/API.md`](../docs/API.md). Autopilot entitlements:
  `GET/PATCH /api/admin/members`. MCP allowlist: `/api/admin/mcp/allowlist`.

## Release acceptance still required

1. Commit the reviewed source and obtain successful CI and CodeQL for that exact
   40-character SHA, with no open high or critical code-scanning alert on the
   protected release ref.
2. Require an independent protected-environment approval and verified,
   least-privilege deployment and registry credentials.
3. Preserve and restore the database recovery point before changing the live
   volume layout.
4. Deploy only the accepted image digests and retain the complete release and
   rollback evidence bundle.
5. Prove database, Auth, REST, Kong, `/api/ready`, migration identity, persistence,
   two restart cycles, backup restore, rollback, login, and controlled campaign
   behavior before real tenant or candidate use — including migrations `0053`–
   `0079` on real Postgres (P-1) and the full gate at one SHA (P-2).
6. Owner: M365 Graph secrets + Entra SSO (E-2) + verified delivery domain (P-7).
7. Run extended Fly E2E (`e2e-workflow-test.sh`) without PARTIAL flags when M365
   live.

## Live deployment note (2026-08-29)

- **Production = Fly only** (`aria-mantu-app.fly.dev`).
- **Live Fly:** tip `b0cf56a` · `/api/ready` **ok** · migration **0079** (`components.migration: true`). Bootstrap applied **0076–0079** after 0077 DROP-before-recreate fix.
- PR [#40](https://github.com/mysticalsin/aria-sourcing/pull/40) tracks REI Autopilot send + prep path (supersedes closed #39).
- **Remaining for full objective:** Settings HeyReach + Autopilot entitle + Sequences + `ARIA_LOOP_WORKSPACE_IDS`, M365 dropzones for live Teams book (Graph **HOLD** while owner Microsoft dropzones absent), Autopilot E2E receipt, full Fly E2E without PARTIAL flags.
