---
plan: 03-test-typecheck-and-doc-truth
owner: Sonnet-QA-Types
reviewer: Sonnet-Final-Validator
status: complete
---

# 03: Strict test typecheck and derived documentation truth

## Fresh baseline (2026-07-14)

- `npm run typecheck:tests` initially reported 152 diagnostics after enabling
  `allowImportingTsExtensions` across 187 TypeScript test roots.
- Narrow spawn-dependency types in the two manifest runners removed the two
  Plan 02-owned diagnostics. The bounded repair baseline is 150 diagnostics
  across 45 test files.
- `typecheck:tests` is intentionally not in CI until the count reaches zero.

## Completion evidence (2026-07-14)

- The strict test compiler now exits 0 across every TypeScript test root. The
  repair reduced the measured baseline from 152 diagnostics to zero without
  exclusions, suppressions, or weaker compiler settings.
- Eight bounded fixture commits separate framework, process, MCP, sourcing,
  outbound, route/provider, and platform changes. `tests/helpers/process-env.mts`
  provides scoped mutation and exact restoration for environment-based tests.
- The Quality job now runs `npm run typecheck:tests` immediately after the
  application typecheck. `tests/docs-truth.mts` permanently rejects CI drift
  from either TypeScript contract.
- The canonical 183-process lifecycle exited 0 after the final fixture changes.
  The independent Obscura command exited 0 with an explicit skip because no
  verified local binary or reachable sidecar was configured. CI now performs a
  bounded sidecar readiness check and sets a required-test mode that exits 1
  when Obscura is unavailable; the release contract executes that failure path.
- Final focused proof: application typecheck, test typecheck, manifest contract
  8/8, documentation truth 44/44, infrastructure release contract 134/134,
  lint, and `git diff --check` all exited 0.

## Scope

1. Add `tsconfig.tests.json` and `typecheck:tests`. Capture a fresh diagnostic
   baseline after the manifest lands.
2. Fix test-only diagnostics sequentially in families capped at 25 diagnostics:
   framework and authority, process/environment/fetch, then remaining tests.
3. Prefer typed fixture builders and scoped environment helpers. Do not weaken
   compiler settings, exclude failing files, add blanket suppressions, or
   change application behavior solely to silence a test diagnostic.
4. Add `typecheck:tests` to CI only after it reaches zero locally.
5. Make test counts and the migration tip derive from the manifest and the
   migration directory. Documentation must not carry hand-entered counts.

## Verification

```sh
npm run typecheck
npm run typecheck:tests
npm run test:manifest
npx tsx tests/docs-truth.mts
npm run lint
npm test
git diff --check
```

Commit each diagnostic family separately. If a family requires product-code
behavior changes, stop and create a separate correctness task.
