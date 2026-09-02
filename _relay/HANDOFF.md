---
project: MSourcing / ARIA
shift: 481
agent: cursor-cloud
updated: 2026-09-02T02:10Z
status: pr-open-never-0-awaiting-fly
---

# Handoff — Shift 481

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** (not merged). Title: Sourcing engine: never-0 harvest chain (PR 54)
- Leftover **PR #53 OPEN**. Do not touch. Do not merge
- Product tip: **`5728ad4`** — last empty harvest POSTs enrich + GitHub `/runs` and logs those run ids
- Previous tip `510c950` walked live (Ultron): 8 distinct harvestapi run ids, all SUCCEEDED items=0, fail-loud, no invented people. H1/overflow/Apify chrome PASS. Product FAIL: enrich/GitHub never started, zero enrich/github audit rows
- Local gate green on `5728ad4`: `npx tsc --noEmit && npm run typecheck:tests && npm test`
- This VM did not Path-B / Fly / Vercel
- Proof host is **https://aria-mantu-app.fly.dev/** only. Ignore the red Vercel GitHub check. Aria is Fly-only
- READY TO MERGE stays **no**
- Polo parked. Overlay/Métis out of scope. Calypso is a **need**. No OAuth. No send. No merge

## Done this shift

1. Investigated why enrich/GitHub were skipped on `510c950`: hypothesis confirmed. `enrichCampaign` / `enrichProfilesByUrl` / `scrapeGithubTechStack` return immediately when there are no LinkedIn URLs / GitHub logins. Tests stubbed `enrich()` as a JS call, not an actor start with a run id. `logAriaHarvest` also hardcoded `actor: HARVEST_ACTOR`, so enrich/github rows could not appear as distinct trail rows
2. Last one-step empty harvest (`isLastPeopleFirstHarvest`) now calls `runPeopleFirstEmptyFallthrough`: POST `harvestapi~linkedin-profile-scraper/runs` and `apivault_labs~github-profile-scraper/runs` even with empty URLs, `logAriaHarvest` with those actor names + run ids, then LinkedIn web alternate (`Business Analyst Montreal`, not another Calypso harvestapi string)
3. Discovery clearance is `peopleFirstEnrichmentClearance` → `clearDiscoveryCriteria`. `apify.ts` does not mint. Harvests 1–7 one-step empty still return EMPTY without fall-through
4. Auto source refuses 0-and-stop success unless both `enrich=` and `github=` run ids are logged. Exhausted empty stays `ok:false`
5. Tests: people-first-chain (18), auto-source (18), apify empty `/runs`, route-authority last-vs-first harvest, H1/overflow, provider-egress mint chokepoint. Full gate green

## Blockers

- Official LinkedIn partner search is not wired. Do not complete OAuth. Do not invent candidates
- This VM does not deploy Fly. Live enrich/GitHub start after 8 empty harvests is unproven until Devon Path-B `5728ad4` and Ultron re-walks
- Vercel GitHub check is red. Ignore it. Do not spend a run making it green
- A click can still end with 0 people if enrich/GitHub/alternate also find nobody. That is fail-loud, not success — but the click must have logged an enrichment attempt. Do not invent people to fill a 0

## Next steps

```bash
# Devon: Path-B PR 54 tip 5728ad4 onto aria-mantu-app (Fly only)
# Ultron: camp_1788068519249 query=Calypso Business Analyst
# KEEP: one click still runs 8 distinct harvestapi run ids
# After those 8 are SUCCEEDED items=0, same click MUST start enrich + GitHub and show those run ids on the aria_harvest trail
# A click cannot end at 0 people without a logged enrichment attempt
# If enrich/GitHub have nobody, LinkedIn web alternate (Business Analyst Montreal) — not another Calypso harvestapi string
# Shortlist: email+phone+LinkedIn, skill-match >=60, cap <=20
# H1 stays Your next move is ready. Overflow WRAP. Two chrome clicks only. No Apify/actor names on chrome
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
- `enrichCampaign` is not that start when items=0 — POST `/runs` even with empty URLs so a run id exists
- People-first Source next batch is the same chain as Auto source
- Fail-loud toasts must not send Tony to an Apify button
- Toast suffix is `enrich=` / `github=` only — no actor names in user chrome
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
- Do not touch Vercel, Polo, Overlay/Métis, or PR #53
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
