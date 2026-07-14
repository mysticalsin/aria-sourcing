---
plan: 03-test-typecheck-and-doc-truth
owner: Sonnet-QA-Types
reviewer: Sonnet-Final-Validator
status: pending
---

# 03: Strict test typecheck and derived documentation truth

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
