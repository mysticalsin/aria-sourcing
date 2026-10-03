# Repository responsibility and document authority

This file maps verified review responsibility and sources of truth. It does not
grant GitHub, Fly, database, provider, or production approval authority.

## Working roles

The project contract in [`AGENTS.md`](../AGENTS.md) defines two AI-tool roles:

| Role | Responsibility |
|---|---|
| Claude Code, builder and integrator | Implements features, runs the full gate, creates reviewable commits, verifies deploy evidence, and maintains goal and Relay state |
| Codex, adversarial auditor | Reviews correctness, security, specification compliance, and missing edge cases; records findings in `_relay/codex-findings.md` |

Either tool may write code. Uncommitted work from either tool is real work and
must not be reset, cleaned, stashed, or overwritten. A writer does not approve
its own release merely by passing local tests.

No `.github/CODEOWNERS` file is present. Do not infer GitHub reviewers, human
maintainers, or production approvers from this document. Repository and
environment permissions remain the external source of truth.

## Authority map

| Concern | Source of truth | Required review focus |
|---|---|---|
| Current shift and blockers | `_relay/HANDOFF.md` | Evidence, exact commands, honest external blockers |
| Product architecture | `docs/ARCHITECTURE.md` | Module direction, authority boundaries, runtime flow |
| API contracts | `docs/api/openapi.yaml` and route tests | Authentication, tenancy, errors, idempotency |
| Domain and persisted types | `src/lib/types.ts`, migrations, serialization tests | Compatibility and migration impact |
| Database authority | Ordered `supabase/migrations/` | RLS, grants, search path, replay, concurrency |
| Production deployment | `production-readiness/DEPLOYMENT_RUNBOOK.md` | Exact SHA/digests, protected authority, recovery evidence |
| Dated release posture | `production-readiness/STATUS.md` | Separate source, release, and live truth |
| Security policy | `SECURITY.md`, negative tests, and CI security gates | Secrets, tenant isolation, candidate privacy, fail-closed behavior |
| Verification | `package.json`, `tests/`, and `docs/TESTING.md` | Permanent registration and reproducible evidence |

Before changing an authority surface, read its negative tests and every later
migration or workflow step that supersedes it. Production acceptance requires
independent evidence on the exact release SHA; local success is insufficient.
