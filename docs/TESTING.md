# Testing and release evidence

ARIA uses layered verification. A narrow unit or contract test does not prove a
database migration, container image, protected release, or live campaign.

## Fast local loop

Use the focused test that owns the behavior being changed:

```bash
npx tsx tests/<suite>.mts
```

Route tests that use Node module mocks must keep the repository's existing
`node --experimental-test-module-mocks --import tsx` invocation.

## Mandatory source gate

```bash
npm run typecheck
npm run lint
npm test
npm run build:isolated
```

`npm test` is the canonical contract suite. `package.json` maps its three npm
lifecycle phases to `tests/test-manifest.mjs`, and
`scripts/run-test-manifest.mjs` validates and executes that literal process
inventory without a shell. Do not create another copied command list.
`build:isolated` is required in the OneDrive checkout because it copies build
inputs to a temporary unsynced directory before running the Next.js build.

## Security gate

```bash
npm run test:security
npm audit --audit-level=high
gitleaks git --redact --log-opts="--all"
```

`npm audit` and image/package downloads depend on external networks. A timeout
is not a pass; record it as blocked and retain the last proven result only with
its exact lockfile or digest.

## Database behavior

These commands require Docker and create disposable databases:

```bash
npm run test:db-privileges
npm run test:db-agent-memory
npm run test:db-agent-operational-rollback
npm run test:db-candidate-erasure
npm run test:db-cross-channel-cap
npm run test:db-apollo-enrichment
npm run test:db-sourcing-learning
npm run test:db-conversation-authority
npm run test:db-agent-framework
npm run test:db-owner-recovery
npm run test:fly-db-volume
```

They cover direct-session privilege separation, migration idempotence, retired
credentials, exact-scope agent memory, current-tip operational fallback and
forward recovery, candidate-erasure authority, cross-channel daily-cap
serialization, Apollo authority, adaptive-sourcing lessons, conversation and
framework authority, orphan-owner recovery, legacy-volume refusal, and restart
persistence. This list mirrors the disposable-database jobs in
`.github/workflows/ci.yml`; update both when adding a database gate.

Static SQL-text tests are useful regression guards but do not replace these
database behavior tests.

## Documentation and repository contracts

```bash
npx tsx tests/docs-truth.mts
npx tsx tests/repository-hygiene.mts
```

These tests derive current process counts from the manifest and migration tips
from the migration directory. Avoid unchecked hand-entered totals in current
documentation.

## CI and protected release

Local green is necessary but does not qualify a production release. The exact
release SHA must have:

- CI quality, dependency, secret, database, image, and aggregate release jobs;
- CodeQL with no open high or critical alert;
- protected-branch and independent-environment approval;
- recovery receipt bound to the release and recovery target;
- immutable image digests, scans, SBOM validation, and attestations;
- accepted release evidence artifacts.

The production workflow must execute from the protected release ref and deploy
the same reviewed SHA.

## Live acceptance

After deployment, verify:

1. application, login, liveness, and `/api/ready`;
2. authenticated Kong REST and Auth behavior;
3. running image and build identity;
4. complete migration identity;
5. database and Auth persistence across two controlled restarts;
6. first-admin provisioning and login;
7. one synthetic zero-send campaign;
8. exact-owner run, event, memory, and conversation receipts;
9. drafts retained only in the intended storage;
10. zero provider outbox rows or sends for the Agent graph.

Use synthetic identities and content. Do not use real candidate data for
acceptance.

## Reporting results

For every gate, record:

- exact commit or image digest;
- command or workflow run;
- exit status and relevant counts;
- environment used;
- skipped or blocked steps;
- whether the evidence proves source, release, or live behavior.

Do not summarize a partial gate as full production readiness.

## Current proof gaps

The chained source gate does not currently include:

- a real-browser Agent Studio journey;
- two-user concurrent Agent execution through deployed application APIs;
- axe, keyboard, and mobile-viewport acceptance;
- behavioral coverage instrumentation and enforced thresholds;
- a real email and official WhatsApp send-and-reply round trip;
- production restart, recovery, and exact-release acceptance for the current
  migration tip.

Static source assertions and mock-server harnesses remain useful regression
checks, but they do not close these gaps.
