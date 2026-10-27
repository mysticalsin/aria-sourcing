# Working connected local demo

Status: ready-for-human

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

## Validation boundary (owner instruction, 2026-10-27)

Do not install Docker or WSL in the current Windows session. Docker startup and
restart acceptance will be performed on another machine. The implementation,
unit/route tests, dependency audit and production build are checked here. The actual Compose/browser recipe is provided in DOCKER.md and
automated as a CI job. Do not mark Docker acceptance passed without its receipt.
## Linux CI receipt (2026-10-27)

Implementation 0be6b3ca passed the full CI release gate in run 40498433529.
The real Docker/browser receipt passed clean startup, readiness, browser login,
UI campaign and candidate creation, encrypted credential storage, refresh, stack
restart, fresh login, restored state and credential decryption, with zero
external-provider calls. The owner can repeat this on another machine; Docker
and WSL were not installed on this Windows session.

Confirmed again at final code 43b9db34 by successful CI 40499885119 and CodeQL
40499885130. All required jobs, including Docker and Database security, passed.
