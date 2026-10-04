---
plan: 04-store-extraction-and-release-proof
owner: Sonnet-FullStack
reviewer: Sonnet-Final-Validator
status: pending
---

# 04: One store extraction and release proof

## Scope

1. Characterize the four current booking/report actions in
   `tests/store-booking-report-actions.mts`, including failed persistence,
   live-mode capability, suppression, event order, activity text, and report
   merge rules.
2. If characterization exposes false success after a rejected commit, fix that
   behavior in a separate correctness commit before extraction.
3. Extract only those actions to
   `src/lib/store/booking-report-actions.ts`. Keep `src/lib/store.ts` as the
   stable `@/lib/store` facade and preserve `HermesActions`.
4. Register `tests/store-booking-report-actions.mts` in the canonical group in
   `tests/test-manifest.mjs` and its manifest contract in the same commit. It is
   not accepted as a one-off-only regression.
5. Pin `@playwright/test` to exact version `1.61.1` in the lockfile, add
   `playwright.config.ts`, and add
   `tests/e2e/synthetic-release-smoke.spec.ts` plus
   `scripts/run-synthetic-e2e-server.mjs`. Add `dev:e2e=node
   scripts/run-synthetic-e2e-server.mjs` to `package.json`. The runner must bind
   Next only to `127.0.0.1:3417`, fail if the port is occupied, and construct an
   allowlisted child environment containing only required OS process variables,
   `NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true`,
   `NEXT_PUBLIC_ENABLE_AZURE_LOGIN=false`, and a fixed non-production
   64-character `DEMO_SESSION_SECRET`; no Supabase, LLM, sourcing, OAuth, or
   delivery credential may be inherited. It must forward termination signals,
   kill the whole child process group, await exit, and remove temporary state.
   Configure Playwright with one worker, `reuseExistingServer: false`,
   `baseURL: http://127.0.0.1:3417`, and managed web-server command `npm run
   dev:e2e`. Let Playwright own startup and readiness. Add
   `tests/synthetic-e2e-server.mts` to prove the environment allowlist, occupied-
   port failure, signal forwarding, process-group cleanup, and nonzero child
   propagation; register that contract in the canonical manifest.
   Log in through the real `admin` / `admin` demo form, navigate by clicking the
   first synthetic campaign instead of hard-coding an ID, keep public-demo
   side-effect denial active, reject non-local browser requests, and fail on any
   unexpected browser console error. Cover login, campaign detail,
   booking/report actions, and desktop/mobile widths without live candidate
   data or outbound messages. Add `test:e2e:smoke=playwright test
   tests/e2e/synthetic-release-smoke.spec.ts` to `package.json`, register an
   exact `release-smoke` group in `tests/test-manifest.mjs`, contract that group,
   and invoke it from CI after `npx playwright install --with-deps chromium`.
6. Run four read-only review lanes on the same SHA: application behavior,
   structure/imports, security/privacy, and release evidence.
7. Archive the current baton and write the next fresh `_relay/HANDOFF.md`
   snapshot before any push.

## Full proof

```sh
npx tsx tests/store-booking-report-actions.mts
npx tsx tests/store-contracts.mts
npx tsx tests/workspace-effectful-actions.mts
npx tsx tests/scoring-metrics.mts
npx tsx tests/module-boundaries.mts
npx tsx tests/synthetic-e2e-server.mts
npm run test:e2e:smoke
npm run typecheck
npm run typecheck:tests
npm run lint
npm test
npm run test:security
npm run test:owner-recovery
npm run build:isolated
npm run test:db-privileges
npm run test:db-agent-memory
npm run test:db-agent-operational-rollback
npm run test:db-agent-framework
npm run test:db-candidate-erasure
npm run test:db-cross-channel-cap
npm run test:db-apollo-enrichment
npm run test:db-sourcing-learning
npm run test:db-conversation-authority
npm run test:db-owner-recovery
npm run test:fly-db-volume
npm run test:graphify-learning
npm audit --offline --audit-level=moderate
gitleaks dir . --no-banner --redact --verbose
git diff --check
```

## Push and readback gate

Push only after credential authority is proven. Read the remote branch SHA
back and inspect exact-SHA GitHub Actions and CodeQL with `gh`. A local pass
does not authorize production deployment.

```sh
SHA=$(git rev-parse HEAD)
BRANCH=$(git branch --show-current)
REMOTE_SHA=$(git ls-remote origin "refs/heads/$BRANCH" | awk '{print $1}')
test "$REMOTE_SHA" = "$SHA"
gh run list --repo mysticalsin/aria-sourcing-demo --commit "$SHA" \
  --limit 100 --json databaseId,workflowName,headSha,status,conclusion,url \
  > "/tmp/aria-runs-$SHA.json"
SHA="$SHA" node - "/tmp/aria-runs-$SHA.json" <<'NODE'
const fs = require("node:fs");
const runs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
for (const workflowName of ["CI", "CodeQL"]) {
  const accepted = runs.some((run) =>
    run.workflowName === workflowName &&
    run.headSha === process.env.SHA &&
    run.status === "completed" &&
    run.conclusion === "success"
  );
  if (!accepted) throw new Error(`${workflowName} is not green for ${process.env.SHA}`);
}
NODE
gh api --method GET repos/mysticalsin/aria-sourcing-demo/code-scanning/alerts \
  -f state=open -f per_page=100 > "/tmp/aria-codeql-alerts-$SHA.json"
node - "/tmp/aria-codeql-alerts-$SHA.json" <<'NODE'
const fs = require("node:fs");
const alerts = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (alerts.length !== 0) throw new Error(`${alerts.length} open CodeQL alert(s)`);
NODE
```
