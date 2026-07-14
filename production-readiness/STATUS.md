# Production Readiness Status

**Date:** 2026-07-14

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
- The Fly release builds the application, database, bootstrap, Kong, and
  one-shot Graphify lesson-worker images for `linux/amd64`; pulls Auth and REST
  at their exact config-pinned upstream digests; schema-validates CycloneDX 1.7
  SBOMs and applies HIGH/CRITICAL plus secret gates to all 7 images; attests and
  promotes the 5 local builds; and verifies all 6 deployed service digests.
  Graphify has a pre-publication container test and immutable supply-chain
  evidence, not a post-promotion execution receipt.
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
- Inbound candidate replies are queue-only and require named human review;
  legacy reply flags never grant provider delivery authority.
- Agent graph drafts stay in exact-owner run history with no delivery authority.
  They do not create a review queue or provider outbox row.
- Email and WhatsApp claims share one serialized per-seat capacity lock, and an
  ambiguous provider outcome continues to reserve capacity.
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
  contact reimport path covered by migration 0033. Two-session tests prove both
  writer-first and erasure-first lock orders. This does not cover candidate data
  embedded in agent-run JSON, framework results, or encrypted agent memory.

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
   behavior before real tenant or candidate use.
6. Before enabling candidate erasure for production acceptance, add explicit
   candidate provenance and erasure receipts for run, framework, and memory
   payloads; an independently retained restore-replay journal; verified provider
   deletion evidence; and a supported path above 100 provider obligations.
7. Keep the 0032 application-surface fallback disabled unless a protected apply
   job and append-only, ledger-safe forward migration are independently reviewed;
   otherwise use approved restore or a new forward migration.

Until those release gates pass, source readiness must not be described as live
production readiness.
