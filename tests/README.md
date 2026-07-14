# Test suite map

The tests are executable product, security, data, and release contracts. The
mandatory project gate is `npx tsc --noEmit && npm test`; focused commands help
diagnose a change but do not replace that complete gate.

## Where tests live

| Path | Purpose |
|---|---|
| `tests/*.mts` | Deterministic application, security, route, documentation, and release contracts |
| `tests/db/*.sql` | SQL assertions executed inside disposable PostgreSQL environments |
| `tests/*.sh` | Isolated database and container harnesses |
| `tests/helpers/` | Reusable test-only parsers and fixtures |
| `tests/fixtures/` | Synthetic, non-production fixture data |

## Choosing a gate

| Change | Minimum focused proof before `npm test` |
|---|---|
| Client or domain behavior | Matching `tests/<feature>.mts` contract |
| API authority | Positive and negative route tests plus `npm run test:security` |
| Database migration or RLS | Matching disposable `npm run test:db-*` command |
| Recovery or release | Contract test plus the relevant recovery/container gate |
| Imports or module layout | `npx tsx tests/module-boundaries.mts` |
| Documentation truth | `npx tsx tests/docs-truth.mts` |

New regressions must be registered in the canonical test definition in the same
commit as the fix. A one-off passing command is not permanent coverage. Preserve
fail-fast behavior for the canonical gate and keep the sandbox runner as a
separate keep-going diagnostic.

Use synthetic identities and records only. Never place candidate PII, provider
credentials, private evidence, decrypted memory, or production identifiers in
test source, snapshots, logs, or fixtures. Database harnesses must use unique
project names and clean only resources they created.

See [`docs/TESTING.md`](../docs/TESTING.md) for the full verification tiers and
[`docs/OWNERSHIP.md`](../docs/OWNERSHIP.md) for review responsibility.
