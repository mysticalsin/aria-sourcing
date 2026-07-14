---
plan: 01-ci-reconciliation-and-navigation
owner: Sonnet-FullStack
reviewer: Sonnet-Security
status: pending
---

# 01: CI reconciliation and repository navigation

## Scope

1. Reconcile commit `ee0cee9` into the current structure branch. Its scope is
   exactly ten files:

   - `src/app/winlog/page.tsx`
   - `src/lib/ai/web-tools.ts`
   - `src/lib/utils.ts`
   - `tests/channels.mts`
   - `tests/mcp-query-auth.mts`
   - `tests/obscura-integration.mts`
   - `tests/safe-exit-traps.mts`
   - `tests/web-tavily-key.mts`
   - `tests/web-tools.mts`
   - `tests/winlog.mts`

   Inspect `git show ee0cee9` before applying it. Do not reimplement from a
   summary. Commit this reconciliation separately.
2. Extract only the reusable import-graph reader from
   `tests/store-contracts.mts` into `tests/helpers/import-graph.mts`. Preserve
   all existing assertions.
3. Add `tests/module-boundaries.mts` with synthetic poison fixtures for import
   cycles and the forbidden directions: `src/lib` importing `src/components` or
   `src/app`, `src/components` importing `src/app`, and client-reachable code
   importing server-only modules.
4. Register `tests/module-boundaries.mts` in the canonical `npm test` command in
   `package.json`. Plan 02 must preserve it as a named canonical-manifest entry;
   the test is not accepted if it runs only as a one-off command.
5. Add developer maps at `src/lib/README.md`, `tests/README.md`,
   `scripts/README.md`, `infra/README.md`, and `docs/OWNERSHIP.md`. Link them
   from `README.md`, `docs/README.md`, and `docs/ARCHITECTURE.md`. Describe
   verified role ownership only; do not invent GitHub handles.

## Verification

```sh
npx tsx tests/winlog.mts
npx tsx tests/mcp-query-auth.mts
npx tsx tests/web-tavily-key.mts
npx tsx tests/web-tools.mts
npx tsx tests/channels.mts
npx tsx tests/safe-exit-traps.mts
npx tsx tests/module-boundaries.mts
npx tsx tests/store-contracts.mts
npx tsx tests/docs-truth.mts
npm run test:security
npm run typecheck
npm run lint
git diff --check
```

Use separate commits for the CI fix, boundary contract, and navigation docs.
