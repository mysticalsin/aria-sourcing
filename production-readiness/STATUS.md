# Production Readiness Status

**Date:** 2026-07-11

This page describes source and release-gate status. It is not evidence that a
particular production deployment is healthy.

## Source candidate

- Node 22, Next.js 16, React 19, and TypeScript 5 are enforced by the repository.
- `npm test` runs 121 chained checks: 17 pretest commands plus 104 application
  test commands.
- Local acceptance requires typecheck, lint, the full test chain, the isolated
  production build, the exact database restart test, and the database authority
  test.
- The Fly release builds the application, database, bootstrap, and Kong images
  for `linux/amd64`; pulls Auth and REST at their exact config-pinned upstream
  digests; schema-validates CycloneDX 1.7 SBOMs and applies HIGH/CRITICAL plus
  secret gates to all six images; attests and promotes only the four local
  builds; and verifies every running digest before acceptance.
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

Until those release gates pass, source readiness must not be described as live
production readiness.
