You are the Integrator building Rock 1 (the company rock) in the MSourcing/ARIA Next.js repo. workspace-write. Build EXACTLY this.

Objective: make a pasted hiring need return real, FITTING candidates — real PEOPLE (not GitHub orgs), location-aware. Today the loop is real but a bare `language:python` query returns orgs (openai/google) and the parser drops the location.

Read first: (understand before editing)
- src/lib/mock-ai.ts parseEmailAndJD (~line 351): a real regex parser. It sets jobAnalysis.location. Verify whether it extracts "in London" / "team in London" / "based in X" — currently it returned location="" for a JD that said "in London". Find where location is (or isn't) parsed and fix it.
- src/lib/sourcing/github.ts searchGithubUsers (~79): calls GitHub `/search/users`. That endpoint returns BOTH users and orgs. Forcing `type:user` in the query is the single-chokepoint fix so EVERY caller gets people, not orgs.
- src/lib/store.ts ~1225: the client builds `language:${skill}` for GitHub. It should also include the location (when present) and rely on github.ts for type:user.
- scripts/smoke-source-live.mts: the existing live smoke (already runs). It builds its own query and asserts candidates.
- tests/ uses `.mts` files with a simple ok()/RESULT harness (see tests/email-unsubscribe.mts for the style).

Constraints: (what must NOT change) do not touch the LinkedIn wire-enforcement or outreach guardrails. Do not add scraping. Keep github.ts's existing public-profile mapping. Do not weaken or delete any existing test. Backward compatible: a query that already contains `type:` must not get a duplicate.

Build:
1. parseEmailAndJD: extract a location from the pasted text ("in London", "team in London", "based in <City>", "location: <City>") into jobAnalysis.location.
2. searchGithubUsers: ensure the effective query contains `type:user` (append ` type:user` when the caller's query doesn't already specify a `type:`), so orgs are excluded.
3. store.ts GitHub query builder (~1225): include the location (e.g. ` location:${city}`) when jobAnalysis.location is set.
4. Upgrade scripts/smoke-source-live.mts: build the query the same way (language + location, rely on type:user), and assert every returned candidate is a real user with a real https://github.com/<login> URL — and print them.

Proof: two commands, both run by the Visionary outside the sandbox (tsx cannot start in this sandbox — that is expected; you only need to make the code compile). (a) `npx tsx tests/intake-location.mts` — CREATE this offline test asserting parseEmailAndJD extracts "London" from a JD that says "team in London". (b) `npx tsx scripts/smoke-source-live.mts` — live, asserts ≥3 real user candidates. Also run `npx tsc --noEmit` yourself and confirm it is clean.

Stop when: `npx tsc --noEmit` is clean, tests/intake-location.mts exists and is written to assert London extraction, and scripts/smoke-source-live.mts is upgraded to enforce type:user + real github.com URLs. Do not delete, skip, weaken, or narrow tests to make the goal pass.

Report: end with the tsc result and, on the final line alone, exactly one of:
ROCK-STATUS: DONE
ROCK-STATUS: BLOCKED <one-line reason>
