# Working connected local demo

Status: in-progress

## Scope

Implement part 1 of the agreed recruiting demo: reproducible Docker startup,
authenticated persistent workspace, trustworthy connection diagnostics and
refresh/restart acceptance. Review local service count and prepare a compatible
Azure direction without deploying cloud resources. Hosted GPT/Claude setup and
LinkedIn-first discovery remain later slices.

## Acceptance

- Default Docker startup builds an immutable app image and waits for backend
  and exact migration readiness. Bind published local ports to loopback.
- Retain only justified services, document the five runtime services and two
  initialization jobs, and keep development mounts optional.
- Preserve the database and encryption key through normal stop/restart.
- Settings distinguishes a verified backend from saved but untested optional
  providers, without spending provider credits or exposing secrets.
- Run clean-stack browser acceptance in an isolated Docker project: login,
  campaign, manual fixture candidate, encrypted fixture credential, refresh,
  full stack restart and fresh authenticated persistence/decryption checks.
- Keep npm typecheck, test typecheck, tests and lint green. Make the Docker
  acceptance a required CI release-gate dependency.
- No Azure deployment, production-data mutation, destructive workspace reset,
  or real sourcing/outreach provider calls in this slice.

## Infrastructure decision

See docs/adr/0001-local-runtime-and-azure-target.md. Retain the current Supabase
boundaries; optimize the app runtime and health/startup semantics. Do not present
Azure Flexible Server as compatible with the existing superuser bootstrap.