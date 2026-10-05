# Aria E2E receipt: never-0 harvest chain (Claude Code on Totos-Mac)

Branch: `cursor/aria-e2e-mac-opus` (PR 54 follow-up). SHA: see `git log -1` on the branch; filled in the commit line at the bottom.
Base: `5728ad4` (the SHA Ultron walked live).
Not merged. Not deployed. Vercel untouched. No people invented.

## Live fail, read from Fly (read-only `fly logs -a aria-mantu-app`, 2026-09-02T02:36-02:39Z, SHA 5728ad4)

| Time (UTC) | Trail line | What it proves |
| --- | --- | --- |
| 02:36:36 | `request_exit detail=SOURCING_AGENT_RATE_LIMITED` | 8 POSTs per click hit the 10/min limiter (and each POST is one of 10 daily sourcing runs). The next click died. |
| 02:38:12 to 02:39:12 | 8 x `succeeded ... items:0` (`8QPevLiGWXjQcdnzm`, `0UFYNwBgs3ocAv4an`, `Wr8pzeoStCd0QOyVu`, `XR3iEorNQe8tTNxeL`, `MpU8a1L96V4ySv17E`, `eo0lRjgPtGMNBCMMg`, `aOtlZKG3v4PRaAPQs`, `6IKfh6X9GYVa2HBkO`) | harvestapi search returns 0 for every query, including bare `Calypso` and `Business Analyst Montreal`. Each run finishes in about 5s. |
| 02:39:12 | `enrich_started actor=harvestapi~linkedin-profile-scraper status:"invalid-input" started:false` | The enrich POST was rejected by Apify. Body sent `urls: []`, an unknown `profileUrls` field, and mode `Full + email search`. The actor's enum is `Profile details + email search ($10 per 1k)`. No run id. |
| 02:39:12 | `github_started actor=apivault_labs~github-profile-scraper runId:uyQCE2eBvDjHFaNEp items:0` | GitHub POST sent `usernames` (actor field is `profileUrls`), so it started an empty run. That is the "suffix". |
| (absent) | no `alternate_search` line | LinkedIn web ran after enrich with nobody left to enrich. |

Actor schemas were read from the public Apify API (no token): `/v2/actor-builds/xZL6XUI7eo37jGWVY` (profile scraper) and `/v2/actor-builds/DMxY2anIZs0yJeOSC` (GitHub scraper). Evidence copy: `_relay/evidence/2026-09-02-never0-chain/fly-harvest-5728ad4.log` (62 `aria_harvest` lines, no secrets, ANSI stripped).

## What changed (one logical change)

1. **Server owns the chain.** `POST /api/sourcing-agent` runs every planned harvest (fresh 90s each, `PEOPLE_FIRST_ATTEMPT_WAIT_MS`), then LinkedIn web discovery, then enrich, then GitHub merge, in one request. One click = one sourcing run. `PEOPLE_FIRST_CHAIN_BUDGET_MS` (200s) bounds harvest starts; past it the server answers `PEOPLE_FIRST_HARVEST_CONTINUE` with a `resume` step and the same click re-POSTs once. `harvestQuery` now means "resume from this reviewed step to the end", not "run one step". Off-plan or backwards resume is rejected (409 server-side, ignored client-side), so a replay or a second click cannot desync the chain.
2. **Fallthrough in the order that can produce people.** `people-first-fallthrough.ts`: LinkedIn web (role+geo `Business Analyst Montreal`) -> enrich every LinkedIn URL held (harvest rows that lacked email or phone, plus web hits) -> GitHub merge on handles of accepted people. Nothing to send is logged as `enrich_skipped` / `github_skipped` with the reason. An empty-URL POST is not a run (Apify `invalid-input`), so it is never faked.
3. **Apify inputs match the actor schemas.** `apify.ts`: profile scraper `{ urls, profileScraperMode: "Profile details + email search ($10 per 1k)" }`; GitHub scraper `{ profileUrls, extractRepos, includeLanguageStats }`; `scrapeGithubTechStack` and `enrichProfilesByUrl` fixed the same way. New `runLinkedinProfileScraperAndWait` / `runGithubProfileScraperAndWait` POST `/runs`, poll to terminal, read the dataset, and log `started` (run id) and `succeeded` (items) with the actor name. `getRunStatus` now carries the actor `statusMessage` onto the trail so an all-zero harvest walk is explainable.
4. **Client is one POST per click.** `runPeopleFirstClickChain` re-POSTs only on `CONTINUE`. `runAutoSourcePipeline` never marks a failed or empty chain as enriched. Rate limit / quota / mock / empty are the click's honest fail toast.
5. Contract: `docs/sourcing-engine/DESIGN.md` "Never 0 people" section rewritten to the above. `fly.app.toml` comment refreshed (value unchanged).

## Devil's advocate, answered in evidence

1. **Does this SHA POST enrich AND GitHub and log run ids + item counts?** Yes, with real URLs/handles. `tests/apify-sourcing.mts` asserts the exact bodies and the `started`/`succeeded` run-id + items flow; `tests/sourcing-agent-route-authority.mts` test 43 asserts one enrich POST after discovery with the deduped URL list and a 200 shortlist with email + phone + LinkedIn; test 44 asserts a 0-accept enrich fails with `enrich=<run id> items=<n>` on the copy. When there is no URL to send, the trail says `enrich_skipped` with the reason (test 42), because an empty POST is an Apify `invalid-input`, not a run.
2. **Same click keeps going; rate limit never success?** Route test 42 runs the whole 8-step queue then web/enrich/GitHub in one request (`beginCalls === 1`). `tests/people-first-chain.mts` and `tests/auto-source.mts` assert a rate-limit error is a hard fail with no retry and no enriched banner. `tests/store-sourcing-actions.mts` test 41 asserts CONTINUE is exactly one extra POST.
3. **ONE durable chain?** `route.ts` people-first branch is a single loop over `peopleFirstHarvestQueue` from `resumeIndex` plus one fallthrough call. The old per-request special cases (`requestedOneStep`, `oneStepEmpty`, `isLastPeopleFirstHarvest`, client 8-loop in `sourcing-actions.ts`, per-step `harvestQuery` in `store.ts`) are gone; `tests/sourcing-agent-contract.mts` pins that.
4. **Second click cannot desync?** Resume steps must be on the reviewed plan and move forward (chain test "desync guard", route test 46). One click is one sourcing run, so the 10/day quota and 10/min limiter are no longer consumed 8x per click.

## Proof (command, exit code, evidence path)

Run from the worktree `/Users/tony/dev/aria-pr54/.claude/worktrees/aria-never0-chain` after `npm ci`.

| Command | exit | Evidence |
| --- | --- | --- |
| `node_modules/.bin/tsc --noEmit` | 0 | `_relay/evidence/2026-09-02-never0-chain/tsc.log` |
| `node_modules/.bin/tsc -p tsconfig.tests.json --pretty false` | 0 | `_relay/evidence/2026-09-02-never0-chain/tsc-tests.log` |
| `node --import tsx tests/people-first-chain.mts` | 0 (21 passed) | `_relay/evidence/2026-09-02-never0-chain/chain-test.log` |
| `node --import tsx tests/auto-source.mts` | 0 (16 passed) | `_relay/evidence/2026-09-02-never0-chain/auto-test.log` |
| `node --experimental-test-module-mocks --import tsx tests/apify-sourcing.mts` | 0 (89 passed) | `_relay/evidence/2026-09-02-never0-chain/apify-test.log` |
| `node --experimental-test-module-mocks --import tsx --test tests/sourcing-agent-route-authority.mts` | 0 (47 passed) | `_relay/evidence/2026-09-02-never0-chain/route-test.log` |
| `node --experimental-test-module-mocks --import tsx tests/hermes-cloud-authority.mts` | 0 (19 passed) | `_relay/evidence/2026-09-02-never0-chain/hermes-test.log` |
| `node --experimental-test-module-mocks --import tsx --test tests/store-sourcing-actions.mts` | 0 (53 passed) | `_relay/evidence/2026-09-02-never0-chain/store-sourcing-actions.log` |
| `node --import tsx --test tests/sourcing-agent-contract.mts` | 0 (13 passed) | `_relay/evidence/2026-09-02-never0-chain/contract-test.log` |
| `npm test` (manifest groups pretest + application + posttest, third pass after two stale-assertion fixes) | 0 (39 files, 0 failing subtests) | `_relay/evidence/2026-09-02-never0-chain/npm-test.log` |
| `node_modules/.bin/eslint <changed files>` | 0 (1 pre-existing warning in store.ts:2030) | `_relay/evidence/2026-09-02-never0-chain/eslint.log` |

Note for whoever reruns: `npx tsc` inside the Claude sandbox printed "No errors found" while npm was failing with an EPERM on `~/.npm/_cacache`; the exit code was 1. Use the local binaries or write output to a file.

## Review note (not changed)

A diff review flagged that the route can still answer 200 with `candidates: []` when every contact-complete person found was already on the campaign after dedupe (pre-existing behaviour, `totalFound` says how many). The click chain and Auto source both turn an `ok` result with 0 accepted into the fail-loud empty toast, so no 0-as-success reaches the recruiter. Left as is to keep this change to the chain.

## H1 and overflow

Untouched this shift. `src/components/dashboard/hero-panel.tsx` still renders "Your next move is ready." and `tests/command-center-firstrun.mts` (in `npm test`) pins the H1 and the 1270 overflow wrap.

## Remaining Fly proof (Devon / RocketFuel after land)

- Path-B this SHA onto `aria-mantu-app`. Ultron: camp_1788068519249, one Source next batch click.
- Expect on the web process stdout: `request_entry` once, 8 harvest `succeeded` lines in one request, then `alternate_search`, then either `started`/`succeeded` for `harvestapi~linkedin-profile-scraper` with a run id and items, or `enrich_skipped` with the reason. Then `github_...`. Then one `request_exit`.
- Open question the code cannot answer: every harvestapi search on this tenant returns `SUCCEEDED items=0` in about 5s, including bare `Calypso`. That is an actor/account signal, not a query one. The `succeeded` line now carries the actor `statusMessage`; read it on the next walk. If the Apify account is out of pay-per-result credit, no query will ever return people and the click will fail loud with the evidence, which is the honest outcome.
- If the tenant has no Tavily key, LinkedIn web discovery cannot start and the click says so (`web=Business Analyst Montreal:not_started (no Tavily key in Access & Keys)`). Adding the key is a workspace action, not code.

## Commit

Filled after `git commit`: see the branch tip.
