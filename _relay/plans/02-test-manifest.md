---
plan: 02-test-manifest
owner: Sonnet-FullStack
reviewer: Sonnet-QA-Manifest
status: in-progress
---

# 02: Declarative test manifest

## Scope

1. Recursively expand the current `pretest`, `test`, `posttest`, security,
   framework, database, recovery, and Obscura scripts. Save the exact ordered
   baseline in a contract. Recalculate counts after shift 40; do not copy the
   planning snapshot.
2. Add `tests/test-manifest.mjs`, `scripts/run-test-manifest.mjs`, and
   `tests/test-manifest-contract.mts`.
3. Represent every process as a literal executable plus argv array and spawn
   it with `shell: false`. Unknown groups, executors, duplicate identifiers,
   empty argv, or malformed entries must fail.
4. Define separate `pretest`, `application`, and `posttest` manifest groups.
   Wire `package.json` exactly as
   `pretest=node scripts/run-test-manifest.mjs --group pretest`,
   `test=node scripts/run-test-manifest.mjs --group application`, and
   `posttest=node scripts/run-test-manifest.mjs --group posttest`. Do not point
   `scripts.test` at a group containing the lifecycle groups, because npm would
   run pretest/posttest twice. Expose a direct manifest-only `all` group for
   non-npm callers, ordered pretest then application then posttest.
5. Add a list/trace mode controlled by a test-only environment variable. The
   contract must spawn one actual `npm test` in trace mode, prove that every
   baseline command appears exactly once and in order across all three npm
   lifecycle phases, and prove the direct `all` group emits the same order.
6. First preserve exact recursive order and duplicates. Prove parity and
   commit. Remove only exact duplicate commands in a separate commit, then
   update derived counts.
7. Keep canonical execution fail-fast. Preserve
   `scripts/run-tests-sandbox.mjs` keep-going diagnostics and its final nonzero
   result when any child fails.
8. Preserve the Plan 01 `tests/module-boundaries.mts` entry explicitly in the
   canonical group and contract. Replace the temporary `test:shift40` name with
   durable named manifest groups or remove it once every command it contains is
   represented by the canonical, security, framework, database, or recovery
   groups. No shift-numbered script may remain.
9. Limit modifications to `package.json`, `scripts/run-tests-sandbox.mjs`,
   `docs/TESTING.md`, `tests/README.md`, and `tests/docs-truth.mts`, plus the
   three new manifest files.

## Verification

```sh
node scripts/run-test-manifest.mjs --list all
node scripts/run-test-manifest.mjs --list application
node scripts/run-test-manifest.mjs --list security
npm run test:manifest
node scripts/run-tests-sandbox.mjs
npm test
npm run test:security
npx tsx tests/docs-truth.mts
npm run typecheck
git diff --check
```

Do not combine manifest migration and deduplication in one commit.
