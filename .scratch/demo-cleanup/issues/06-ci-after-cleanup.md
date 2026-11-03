# Verify GitHub Actions after the cleanup

Status: resolved

## Resolution (2026-11-03)

Later runs on mbe-branch passed every required job (Quality, dependency audit,
secret scan, Database security, Local Docker demo, Release gate):

- CI 40498433529 at 0be6b3ca (`.scratch/local-demo-runtime/spec.md`,
  `.scratch/unified-sourcing/spec.md`).
- CI 40499885119 + CodeQL 40499885130 at 43b9db34
  (`_relay/archive/2026-10-27-1524-codex.md`).
- CI 40540178013 + CodeQL 40540177843 at 29967509
  (`_relay/archive/2026-10-29-1300-claude-code.md`,
  `.scratch/candidate-qualification/issues/01-qualification-enrichment.md`).

The fixes are recorded in `_relay/codex-findings.md`, entry "2026-10-27 -
Existing CI blockers reproduced and corrected". The steps below are kept for
history.

## Live verification (2026-10-27)

The branch was pushed through 9c70015b. The previous missing-push statement is
obsolete. CI run https://github.com/mysticalsin/aria-sourcing/actions/runs/40390231331
completed with:

- Quality: success (typechecks, lint, tests, build).
- Dependency audit: failure at Audit high and critical advisories.
- Secret scan: failure at Scan full history including the current release commit.
- Database security: failure at Verify candidate erasure authority.
- Release gate: failure because those three required jobs failed.

Public check annotations only expose exit code 1, not the underlying logs.
Do not interpret Quality passing as an overall green release gate.

## Next steps

1. Inspect the failed job logs with repository access. Keep secret-scan output
   fully redacted; never copy secret matches into this issue or the relay.
2. Reproduce npm audit --audit-level=high and patch supported dependency versions.
3. Reproduce the database job on the disposable Docker/Postgres stack; preserve
   the baseline migration and fix the failing authority assertion or schema via
   a new migration as appropriate.
4. Fix the actual secret-scan cause without disabling the scan, rewriting shared
   history, or blanket-allowlisting matches.
5. Verify every required job on the new branch tip after the Codex changes push.

This Windows session has no Docker executable; database suites were not rerun
here. The local required gate and browser smoke are tracked in HANDOFF.md.