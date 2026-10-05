---
project: MSourcing / ARIA
shift: 479
agent: cursor-cloud
updated: 2026-09-01T23:26Z
status: pr-open-never-0-awaiting-fly
---

# Handoff — Shift 479

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** (not merged). Title: Sourcing engine: never-0 harvest chain (PR 54)
- Leftover **PR #53 OPEN**. Do not touch. Do not merge
- Never-0 code tip: **`2b30d5f`** — empty harvest starts harvest 2 in the same click
- Local gate green on `2b30d5f`: `npx tsc --noEmit && npm run typecheck:tests && npm test`
- Live Fly still the walked SHA **`396b316`** (one harvest, items=0). This VM did not Path-B / Fly / Vercel
- Proof host is **https://aria-mantu-app.fly.dev/** only. Ignore the red Vercel GitHub check. Aria is Fly-only
- READY TO MERGE stays **no**
- Polo parked. Overlay/Métis out of scope. Calypso is a **need**. No OAuth. No send. No merge

## Done this shift

1. Live walk on Fly `396b316` / `camp_1788068519249` disproved `a6785c2`. Do not trust green tests that mock `makeSourcingToolRunner` as proof harvest 2 POSTed
2. Real miss: one HTTP request tried to run the whole queue. Harvest 1 polls 90s. Fly default idle 60s cuts the connection. Client abort is not EMPTY, so harvest 2 never starts. Auto source called `search()` once
3. Source next batch now POSTs **one** planned harvest per request and loops `peopleFirstHarvestQueue` in the same click. `harvestQuery` set ⇒ server `maxSteps=1`, EMPTY on items=0 (client-continuable), new idempotency key per POST
4. Auto source is `runPeopleFirstHarvestChain`: search → enrich → GitHub merge only when `queryStyle=github` → next search if still empty
5. `fly.app.toml` `idle_timeout = 360` for Devon’s next Path-B
6. Tests: `people-first-chain.mts`, `auto-source.mts` (empty first harvest continues), `store-sourcing-actions.mts` (two `/api/sourcing-agent` POSTs), route one-step `runnerCalls===1`

## Blockers

- Official LinkedIn partner search is not wired. Do not complete OAuth. Do not invent candidates
- This VM does not deploy Fly. Live never-0 is unproven until Devon Path-B `2b30d5f` and Ultron re-walks
- Vercel GitHub check is red. Ignore it. Do not spend a run making it green

## Next steps

```bash
# Devon: Path-B PR 54 tip 2b30d5f onto aria-mantu-app (Fly only)
# Ultron: camp_1788068519249 query=Calypso Business Analyst
# Source next batch: if harvest 1 SUCCEEDED items=0, same click must show a SECOND harvestapi run id
# Banner / plannedHarvests>=2 without that second run id is FAIL
# Auto source: empty first harvest must start search 2 (chain), not one shot
# Shortlist: email+phone+LinkedIn, skill-match >=60, cap <=20
# H1 stays Your next move is ready. Overflow WRAP. Two chrome clicks only
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
- Fail-loud toasts must not send Tony to an Apify button
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
- Route-authority continue fixture must set `lastContactedAt: null`
- Finance/BA Auto source must not dump GitHub leftovers as the shortlist
- Do not weaken `npm audit --audit-level=high` or Trivy `--severity HIGH,CRITICAL --exit-code 1`
- Client empty-continue is regex on EMPTY copy (`Empty harvest is not a result|Next planned search must start`). One-step EMPTY must keep that copy. Abort/NOT_STARTED must not be treated as a toast-and-stop if harvest 2 has not run — the client loop only continues on EMPTY
