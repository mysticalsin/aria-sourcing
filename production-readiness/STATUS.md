# Production Readiness Status

**Date:** 2026-07-21

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
- The checked-in Fly release workflow is designed to build the application,
  database, bootstrap, Kong, and one-shot Graphify lesson-worker images for
  `linux/amd64`; pull Auth and REST at their exact config-pinned upstream
  digests; schema-validate CycloneDX 1.7 SBOMs; apply HIGH/CRITICAL plus secret
  gates to all 7 images; attest and promote the 5 local builds; and verify all
  6 deployed service digests. Graphify has a pre-publication container test in
  that design, not a post-promotion execution receipt.
- No accepted release receipt exists for the current source SHA. GitHub Actions
  currently stops before job steps because of the repository Actions budget,
  the production deploy workflow is manually disabled, the separate framework
  plane has no accepted deployment receipt, and Auth has no accepted
  supply-chain receipt. These are release blockers, not source-test failures.
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
- Web and sourcing-loop processes now register standard OTLP trace and
  aggregate-metric export for the bounded need-to-sourcing path. Structured
  stage receipts exclude candidate, query, credential, provider-body, and raw
  exception content. Production configuration fails closed, but source checks
  do not prove collector ingestion, Fly log-drain delivery, alert delivery,
  on-call ownership, or retention approval.
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
- GoTrue is hardened for a restricted owner-operated deployment: signup is
  disabled; identities must be confirmed and active; passwords require at least
  24 characters and at most 72 UTF-8 bytes; current-password reauthentication and refresh-token rotation are
  required. MFA/AAL2, enterprise SSO, SCIM, invitations, joiner-mover-leaver
  automation, and access recertification are not implemented, so this is not a
  50,000-user IAM acceptance claim.
- Graphify receives only aggregate query fingerprints and outcome counts in an
  isolated no-network worker. Migration `0054` may consume one current,
  human-promoted exact-role lesson only to select or reorder a finite set of
  same-page GitHub query variants that the server already derived from the
  approved role. The lesson, review, export, and query snapshot is frozen before
  egress. Graphify cannot add role needs, provider or credential authority,
  candidate facts, or delivery permission, and a separate administrator must
  promote every lesson version.
- Candidate erasure uses tenant-bound authority, local tombstones, non-final
  provider obligations, and transaction advisory locks for every normalized
  contact reimport path covered by migration `0033`. Migrations `0035`, `0037`,
  and `0059` extend coverage to identified corpus/person records and specified
  top-level candidate shapes in agent-run, agent-event, and framework-result
  JSON. Encrypted agent-memory coverage exists only when the candidate
  provenance is explicitly registered. The application does not yet enforce
  that registration on every memory write, so arbitrary or nested JSON and all
  candidate-bearing memory are not proven erasable.

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
6. Keep candidate erasure disabled for production acceptance until every
   candidate-bearing memory and JSON write is proven to register bounded
   provenance, an approved provider adapter records independently verifiable
   deletion evidence, a separately retained restore-replay journal is tested,
   and a supported path above 100 provider obligations exists.
7. Ratify a 50,000-user workload, execute staged write and provider load, soak,
   failover, restore, and recovery tests with production telemetry, and approve
   a database/session-pool and high-availability design. The current read-only
   synthetic capacity harness is not scale evidence.
8. Activate one exact-model LLM binding only after two real administrators
   provide distinct, fresh purpose-specific capability proofs and a real model
   canary succeeds. A provider model-list response alone is insufficient.
9. Promote the framework plane only after every complete runtime image passes
   the zero HIGH/CRITICAL gate, private bootstrap and restore are proven, and an
   exact-release zero-contact campaign canary succeeds.
10. Keep public need ingress disabled until a shared edge limiter passes the
   multi-host, multi-Machine burst proof.
11. Keep the 0032 application-surface fallback disabled unless a protected apply
   job and append-only, ledger-safe forward migration are independently reviewed;
   otherwise use approved restore or a new forward migration.
12. Provision the external OTLP collector and Fly log drain, ratify the SLOs in
    `docs/operations/OBSERVABILITY.md`, assign named primary and backup
    responders, test every alert route, and bind exact-release ingestion and
    outage-drill evidence to the accepted release receipt.

Until those release gates pass, source readiness must not be described as live
production readiness.
