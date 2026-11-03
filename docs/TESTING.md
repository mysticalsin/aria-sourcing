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
npm run typecheck:tests
npm run lint
npm test
npm run build:isolated
```

`npm test` is the canonical contract suite. `package.json` maps its three npm
lifecycle phases to `tests/test-manifest.mjs`, and
`scripts/run-test-manifest.mjs` validates and executes that literal process
inventory without a shell. Do not create another copied command list.
`build:isolated` copies build inputs to a temporary directory before running
the Next.js build; use it when the checkout lives in a synced folder (OneDrive).

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
npm run test:db-candidate-erasure
npm run test:db-candidates-corpus
npm run test:db-person-model
npm run test:db-cross-channel-cap
npm run test:db-sourcing-learning
npm run test:db-conversation-authority
```

They cover candidate-erasure authority, candidate-corpus mirror authority,
derived person identity, cross-channel daily-cap
serialization, sourcing-run receipts, and
conversation authority. This list mirrors the `database-security` job in
`.github/workflows/ci.yml`; update both when adding a database gate.

Static SQL-text tests are useful regression guards but do not replace these
database behavior tests.

## Repository contracts

```bash
npx tsx tests/repository-hygiene.mts
```

Avoid unchecked hand-entered totals (suite counts, migration tips) in current
documentation; derive them from the manifest and the migration directory.

## CI

`.github/workflows/ci.yml` runs Quality (typecheck, lint, tests, build),
Dependency audit, Secret scan, Database security and Local Docker demo, then a
Release gate that requires all five. `codeql.yml` runs CodeQL.

There is no production deployment: Fly and Vercel were removed and the
self-hosting target is not chosen yet. Release requirements (protected ref,
image digests, environment approval) will be defined with that target.

## Acceptance on a deployed stack

Once a deployment exists, verify after each deployment:

1. application, login, liveness, and `/api/ready`;
2. authenticated gateway REST and Auth behavior;
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

- a real-browser journey through the recruiting pages (a manual Docker smoke
  is the current check);
- axe, keyboard, and mobile-viewport acceptance;
- behavioral coverage instrumentation and enforced thresholds;
- a real email send-and-reply round trip;

Static source assertions and mock-server harnesses remain useful regression
checks, but they do not close these gaps.
