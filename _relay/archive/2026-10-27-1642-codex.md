---
project: MSourcing / ARIA
shift: 444
agent: codex
updated: 2026-10-27
status: apify-auth-verified-actor-allowance-blocked
---

# Handoff - Shift 444

## Current state

- Branch mbe-branch. Code dfc9839f is pushed. Local typecheck, test typecheck,
  full npm test lifecycle, lint and production build passed. Lint has zero errors
  and the two existing navigation warnings. No dependency/schema change this shift.
- Code CI 40519528306 completed SUCCESS: Quality, Database security, Local Docker
  demo, dependency audit, secret scan and Release gate. CodeQL 40519528305 passed.
  https://github.com/mysticalsin/aria-sourcing/actions/runs/40519528306
- Owner provided Apify account credentials and explicitly forbade committing them.
  They are protected with Windows DPAPI under current LocalAppData/ARIA/credentials,
  OUTSIDE the repository. Do not print, commit or copy their contents into env,
  examples, tests, relay or logs. Only safe outcomes are recorded here.
- GET /v2/users/me authenticated successfully (HTTP 200) and matched the supplied
  account. Actor metadata and the bounded input validation also returned HTTP 200.
- One real provider-only smoke run used the sample Backend Go/Kubernetes brief,
  France, Short mode, maxItems=3, takePages=1, timeout=120 and API charge cap USD0.1.
  It returned SUCCEEDED but statusMessage "free user run limit reached", with
  dataset itemCount=0. No candidate was retrieved. Actual invoice cost was not
  audited; do not call this a free run. No second actor was launched.
- A read-only poll of that SAME run verified the new account_limit classification
  with actorStarts=0. Its metadata is under LocalAppData/ARIA/acceptance, outside Git;
  the result payload uses DPAPI. Never automatically start a replacement test.
- Owner clarified ARIA currently runs only locally on ANOTHER machine, not Azure.
  No reachable instance URL/backend/session is available on this Windows machine.
  The key has NOT been saved into that other instance's application vault.
- Exact supplied-credential scans of tracked/staged files found no values. Staged
  redacted Gitleaks scan passed. No real credential or private run ID is in Git.

## Done this shift

1. Safely stored the supplied credentials outside Git, encrypted for the current
   Windows user, and verified account identity without printing secret values.
2. Validated provider access/input and ran exactly one bounded provider-only test.
   Investigated the zero-result outcome using read-only run/dataset/log requests.
3. Found that an actor can report SUCCEEDED while refusing discovery because of
   its free-run allowance. The old adapter stripped statusMessage, making this
   refusal look like a genuine successful empty search.
4. Added apify-status.ts to classify the observed exact refusal into a safe
   account_limit reason, without returning arbitrary provider status text.
5. Unified and legacy sourcing now fail that source with account-allowance guidance
   and settle the provider receipt as failed. Other selected sources can continue;
   genuine successful empty searches remain successful. No automatic paid retry.
6. Added adapter/route/orchestration regressions, verified the classification on
   the existing real run, documented findings and opened unified-sourcing issue 02.
7. Tests/build and complete remote CI passed for dfc9839f. The final wrap-up commit
   changes relay/issue documentation only; any new docs-tip CI is a separate run.

## Blockers

- The actor reports "free user run limit reached" for the supplied account. It
  returned no profiles, so real profile retrieval/import acceptance is still open.
  This message is the provider's stated reason; do not claim the owner used ten
  runs, that the token is invalid, or that a subscription upgrade is the only fix.
- The connected application is on another local machine. Its workspace key vault
  cannot be configured from this session without an accessible authenticated
  instance. No Azure deployment or Windows Docker installation is needed here.

## Next steps

1. Owner: review the actor/account allowance in Apify before another paid search.
   Do not automatically upgrade the account, change billing or retry the actor.
2. On the machine running connected Docker/Supabase ARIA, update mbe-branch and
   rebuild normally, preserving db_data and app_config. Settings -> Workspace ->
   Check connections should verify the core backend.
3. Settings -> API Keys -> Apify: save the token there. Browser-local synthetic
   demo mode intentionally does not persist real provider secrets. The Windows
   DPAPI file is not a portable credential file for another machine.
4. After the provider limitation is resolved, review an active campaign, select
   LinkedIn (and GitHub if useful), inspect the query and choose a low cap (3).
   Record actual profile retrieval, mapping, refresh recovery and dedupe results.
5. Reuse the existing provider receipt for read-only diagnostics, never launch a
   replacement simply because the last result was empty. No candidate/outreach
   state was written by this provider-only check.
6. See .scratch/unified-sourcing/issues/02-apify-account-acceptance.md for the safe
   receipt and remaining owner actions. Check any final docs-only CI separately.

## Decisions made (don't relitigate)

- No real account identifier or API token in Git, env examples, tests, relay or logs.
  Keep secrets in the protected external store until the application vault can be
  configured on the other machine; retain per-workspace authority (no env fallback).
- No Docker/WSL installation on this Windows machine. Docker tests run in Linux CI
  or the owner's other machine. No Azure deployment is requested.
- Preserve the five permanent services and two init jobs, forward migrations,
  stateful volumes and stable encryption key. Sourcing adds no worker/container.
- No automatic retry of ambiguous or provider-blocked paid starts; no silent
  source fallback. Human approval remains required before outreach.
- Hosted GPT/Claude remains deferred; no LLM, mailbox/calendar or outbound action
  was performed. No subscription or payment configuration was changed.

## Watch out

- The actor's top-level status alone is insufficient: this observed SUCCEEDED
  refusal must remain a failed source. Keep normal empty result success intact.
- Do not dump Apify user/run objects or logs; they can contain identifiers or
  personal data. Current safe receipt contains counts/classifications only.
- Source profile data could not be tested live because the dataset was empty.
  Fixture mapping tests and real PostgreSQL/Docker CI remain green, but they do
  not prove real candidate retrieval for this blocked account.
- Local logs: TEMP/aria-apify-limit-*.log. Ignored tmp contains the credential-free
  provider helper and redacted scan receipt. Sensitive credentials/run artifacts
  are under LocalAppData/ARIA outside the repository, never in those logs.
