# Unified campaign sourcing

Status: ready-for-human

The campaign's primary launch selects LinkedIn (Apify) and/or GitHub, reviews
queries and explicit per-source profile limits, then starts one durable run.
No model is required. Hosted model configuration remains a later slice.

Acceptance:
- LinkedIn runs first when selected; GitHub is an independent complementary step.
- Missing provider configuration is explicit; there is no silent source fallback.
- Progress reports persisted source states, actual found/added/duplicate/excluded
  counts, limits and actionable failures. No simulated live progress.
- Refresh resumes the same run. Repeated start/advance requests cannot launch
  another paid actor. An uncertain start is never retried automatically.
- Candidates are scored and deduped against current authoritative workspace
  state and saved atomically with step completion. Source links, missing data
  and next action are visible. Unknown contact/experience stays unknown.
- Partial source failure preserves successful results. Outreach still requires
  human review. Creating a campaign does not start paid sourcing.
- Authentication, workspace ownership, source permission, reviewed active brief,
  query policy and durable provider quotas remain mandatory.
- Gate: typecheck, typecheck:tests, npm test, lint, production build. Provider
  tests use fixtures; real paid-provider and Docker acceptance remain explicit.

Execution uses persisted steps advanced by the campaign page. Navigating away
pauses new steps; an already launched actor continues at Apify and is resumed on
return. No additional worker/container is required.

## Evidence and remaining acceptance

Implemented `src/lib/sourcing/unified-*`, `/api/source/campaign`, the campaign
panel and migration 0003. Dashboard, candidates and fleet actions route to the
same source review. Connected intake and bulk launch prepare campaigns without
starting provider searches. Existing synthetic showcase behavior remains local.

Targeted runtime and API fixtures cover concurrency, role/workspace authority,
source ordering, partial failure, ambiguous starts, refresh, state conflicts,
erased identities, invalid URLs and observed-vs-requested skill evidence.
Browser fixture smoke passed with Edge: source selection, explicit caps, exactly
one launch, refresh in the middle of Apify processing, terminal counters. Rendered
review and result screenshots were inspected (`tmp/unified-*.png`, ignored).
These are fixture receipts, not paid-provider or real-database acceptance.

`tests/db/unified-sourcing.sql` is wired into the existing database security job:
service-only authority, one active campaign run, provider reservation/replay/cap,
stale version rejection, atomic state/completion, role revocation and replay.
Execute it through the Docker CI/other machine; do not install Docker/WSL here.
Real acceptance: connect Apify in Settings, review a low-limit LinkedIn + GitHub
search, refresh during processing, verify source links and counters, rerun and
verify identity dedupe. Hosted GPT/Claude configuration remains deferred.

Local final gate passed: npm run typecheck, npm run typecheck:tests, npm test
(including pre/post lifecycle), npm run lint (zero errors; two existing navigation
warnings), production build and final browser fixture smoke. Staged redacted
Gitleaks scan found no leaks. Code pushed as 8c3376b6 + 56d165bf. CI database and
Docker/provider receipts are separate from these local results.
