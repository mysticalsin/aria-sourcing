---
project: MSourcing / ARIA
shift: 482
agent: cursor-cloud
updated: 2026-10-05T22:42Z
status: pr-open-tony-bar-awaiting-fly
---

# Handoff — Shift 482

## Current state

- Branch `cursor/empty-harvest-enrich-9f77` → **PR #156 OPEN** https://github.com/mysticalsin/aria-sourcing/pull/156
- Closed **PR #54**. Do not reopen. Do not merge #156
- Product: **`2e781e02`** — Tony bar owns enrich/GitHub/web as distinct campaign activities; rate-limit 20/180s
- CI follow-up: **`dd072023`** — CodeQL host check, Gitleaks fingerprints, next 16.3.8, sharp 0.35.4, Debian apt-get upgrade on `Dockerfile.prod`
- STATUS.md date bump: **`f17fe378`**. Merge of `origin/main` js-yaml 4.3.2 is in the PR
- Parent one-request chain: `523ca9a5`. Live FAIL tip was `5728ad4` (empty-URL enrich POST = Apify invalid-input; github= suffix on harvest 8; 10/min burned before trading-platform BA / finance BA)
- Local gate green on `dd072023`: `./node_modules/.bin/tsc --noEmit && npm run typecheck:tests && npm test`
- CI Quality on `24da71a5` was green. Remaining HIGH is `braces` with no published 3.0.4; do not force Tailwind v4; do not weaken `npm audit --audit-level=high` or Trivy `--exit-code 1`
- This VM did not Path-B / Fly / Vercel
- Proof host is **https://aria-mantu-app.fly.dev/** only. Ignore the red Vercel GitHub check. Aria is Fly-only
- READY TO MERGE stays **no**
- Polo parked. Overlay/Métis out of scope. Calypso is a **need**. No OAuth. No send. No merge

## Done this shift

1. Parsed Fly `5728ad4`: empty enrich POST `invalid-input`; GitHub run id only on stdout / harvest-8 EMPTY notes; Auto source 8 POSTs hit 10/min
2. `peopleFirstTrailActivities` + `persistPeopleFirstFailAudit` write own Tony-bar rows (LinkedIn web, enrich, GitHub). Skip is its own row, never a fake run id. Actor names stay out of titles. Persist reverses extras then main so the top row is EMPTY, then web / enrich / github
3. Web parse is `web=(.+?):(\d+|not_started)` so `Business Analyst Montreal` keeps its spaces
4. Empty urls skip the enrich POST (invalid-input is not a run). When URLs exist, POST `/runs` and the row carries `run=` + `items=`
5. Rate-limit `windowMs: 180_000` / `max: 20` so Auto source can reach trading-platform BA / finance BA. Rate-limit is not success
6. Merged `origin/main` (kept `eslint-config-next` 16.3.3). Bumped `production-readiness/STATUS.md` date only
8. CI on `24da71a5`: Quality green. CodeQL Incomplete URL substring in `tests/auto-source.mts` → `URL.hostname`. Gitleaks 3 LinkedIn-rule false positives in deleted history → exact fingerprints. next 16.3.8 + sharp 0.35.4. `Dockerfile.prod` runner `apt-get upgrade`. braces HIGH has no published 3.0.4. Vercel ignored.

## Blockers

- Official LinkedIn partner search is not wired. Do not complete OAuth. Do not invent candidates
- This VM does not deploy Fly. Live Tony-bar rows after 8 empty harvests are unproven until Devon Path-B PR 156 and Ultron re-walks
- Vercel GitHub check is red. Ignore it. Do not spend a run making it green
- A click can still end with 0 people if enrich/GitHub/alternate also find nobody. That is fail-loud, not success — Tony bar must still show own enrich/GitHub/web rows. Do not invent people to fill a 0

## Next steps

```bash
# Devon: Path-B PR 156 (tip dd072023, product 2e781e02) onto aria-mantu-app (Fly only)
# Ultron: camp_1788068519249 query=Calypso Business Analyst
# KEEP: H1 Your next move is ready. Overflow WRAP. Apify off chrome. 8 harvestapi run ids
# After those 8 are SUCCEEDED items=0, Tony bar MUST show own enrich and GitHub rows
#   (run id + item count, or skipped — not a harvest-8 suffix)
# LinkedIn web Business Analyst Montreal is its own row
# Auto source must reach trading-platform BA / finance BA. Rate-limit is FAIL, not success
# Shortlist: email+phone+LinkedIn, skill-match >=60, cap <=20
# This VM: no Path-B, no Fly, no Vercel, no merge
# READY TO MERGE: no
```

## Decisions made (don't relitigate)

- Product name is Aria. Calypso is a client **need**
- Returning Command Center H1 is Aria-shaped. Acting on {title} is chip/subtitle
- Aria can never find 0 people. items=0 is next-search, not a result
- Copy is not next-search. Harvest 2 must RUN (distinct harvestapi run id)
- `plannedHarvests>=2` / banner without a second run is FAIL
- First query stays `Calypso Business Analyst`
- Two user clicks only. Actors stay in the backend
- One harvest per HTTP request when `harvestQuery` is set. Client/chain owns the loop
- After the 4 canned Calypso variants, escalate to role+geo+synonym harvests
- Empty LinkedIn search is not a terminal result. Always attempt enrich + GitHub merge onto the same people
- Empty urls is skipped, not POSTed. Fly 5728ad4 empty-URL POST was invalid-input, not a run
- People-first Source next batch is the same chain as Auto source
- Fail-loud toasts must not send Tony to an Apify button
- Toast suffix is `enrich=` / `github=` only — no actor names in user chrome
- Tony bar enrich/GitHub/web are **own campaign activities**, not a suffix on harvest 8
- Do not hide overflow-x on html/body
- Leftover GitHub / `@example.com` are not LinkedIn people
- Do not invent people to fill a 0
- Banner “every planned search was tried” requires ≥2 distinct harvests that ran
- Devon owns Fly. READY TO MERGE stays no
- Aria is Fly-only. Ignore Vercel CI. Proof is https://aria-mantu-app.fly.dev/ only
- Gitleaks exceptions are exact fingerprints or a single synthetic line, never path allowlists
- Graphify worker may `apt-get upgrade` on the pinned Python base; it may not `apt-get install`

## Watch out

- Do not invent Fly tokens, candidates, emails, phones, or OAuth
- Do not touch Vercel, Polo, Overlay/Métis, or leftover PRs
- Do not regress harvest first query or leftover-GitHub strip
- Do not send the LinkedIn boolean as harvestapi `searchQuery`
- Do not Path-B or Fly-deploy from this VM
- Do not share one 90s abort across planned harvests
- Do not put Application Support into the harvestapi keyword query
- Do not re-declare `const sourceNextBatch = useCallback` in store.ts (factory boundary)
- Route-authority continue fixture must set `lastContactedAt: null`
- Finance/BA Auto source must not dump GitHub leftovers as the shortlist
- Do not weaken `npm audit --audit-level=high` or Trivy `--severity HIGH,CRITICAL --exit-code 1`
- Client empty-continue is regex on EMPTY copy (`Empty harvest is not a result|Next planned search must start`). Harvests 1–7 one-step EMPTY must keep that copy and must not fall through
- `mintProviderClearance` is reachable only from `provider-egress.ts`. Route must not import `provider-egress` (server-only explodes route-authority). Use `peopleFirstEnrichmentClearance` from sourcing-tools
- Do not use `nextPeopleFirstHarvest(job, [current])` to detect the last harvest — that treats untried earlier steps as “next”. Use `peopleFirstHarvestQueue(job).at(-1)`
- Web trail parse must keep spaces in `Business Analyst Montreal` — do not use `\S+`
- `npx tsc` can resolve to tsc@2.0.4; use `./node_modules/.bin/tsc --noEmit`
