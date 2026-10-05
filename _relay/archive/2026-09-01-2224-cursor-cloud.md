---
project: MSourcing / ARIA
shift: 477
agent: cursor-cloud
updated: 2026-09-01T22:35Z
status: pr-open-coding-gates
---

# Handoff — Shift 477

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** (not merged)
- Leftover **PR #53 OPEN**. Do not touch. Do not merge
- Tip: **`ce7b16a`** — Auto source + two-click chrome + never-0 enqueue (`a6785c2`)
- Feature commits: `a6785c2` never-0 queue; `5ff9160` Auto source + strip Apify chrome; tests through `ce7b16a`
- Fly live stays **`a05cf5a`**. This VM did not Path-B / Fly / Vercel
- Local gate green on `ce7b16a`: `npx tsc --noEmit && npm run typecheck:tests && npm test`
- READY TO MERGE stays **no**
- Polo parked. Overlay/Métis out of scope. Calypso is a **need**. No OAuth. No send. No merge

## Done this shift

1. Proved never-0 enqueue already in `a6785c2`. User chrome still said “Source via Apify”; Auto source was missing
2. Two user clicks: **Source next batch** (one harvest) and **Auto source** (`runAutoSourcePipeline`: search → enrich → GitHub tech-stack merge when `queryStyle === "github"`). No AgentRunStream
3. Stripped Source via Apify / actor ids / Sillage / Apollo / Seamless / Run sourcing agent / Run Aria from Command Center, campaign, and candidates chrome. Fail-loud toasts no longer point at an Apify button. Connect Apify / Access & Keys stays for missing/mock key
4. Hidden pipeline: harvestapi LinkedIn search + harvestapi LinkedIn scraper (email/phone/full profile) + apivault_labs GitHub tech-stack merge onto the same people. `githubUrl` now survives `/api/source/enrich`. GitHub leftovers are not the shortlist
5. Tests: never-0 empty→second search still green; contact shape / floor / cap still in `tests/sourcing-engine.mts`; chrome pins in `tests/auto-source.mts` + command-center + campaign lifecycle. User-facing `formatHarvestEvidenceError` has no `actor=`

## Blockers

- Official LinkedIn partner search is not wired. Do not complete OAuth. Do not invent candidates
- This VM does not deploy Fly. This VM cannot re-walk live Calypso

## Next steps

```bash
# Devon: Path B deploy of PR 54 tip ce7b16a onto aria-mantu-app
# Ultron: one Source next batch on camp_1788068519249 query=Calypso Business Analyst
# request_entry plannedHarvests>=2
# If harvest 1 SUCCEEDED items=0: next_search_start + a second harvestapi run id
# Auto source: search + enrich (+ GitHub only when queryStyle=github). One dataset
# Real shortlist: email + phone + LinkedIn, skill-match >=60, cap <=20
# H1 stays Your next move is ready. Overflow WRAP. No Source via Apify chrome
# This VM: coding gates only. Do not merge PR 53 or 54
# READY TO MERGE: no
```

## Decisions made (don't relitigate)

- Product name is Aria. Calypso is a client **need**
- Returning Command Center H1 is Aria-shaped. Acting on {title} is chip/subtitle
- Aria can never find 0 people. items=0 is next-search, not a result
- Copy is not next-search. The loop must start harvest 2
- First query stays `Calypso Business Analyst`
- Two user clicks only. Actors stay in the backend
- Fail-loud toasts must not send Tony to an Apify button
- Do not hide overflow-x on html/body
- Leftover GitHub / `@example.com` are not LinkedIn people
- Do not invent people to fill a 0
- Banner “every planned search was tried” requires ≥2 distinct harvests that ran
- Devon owns Fly. READY TO MERGE stays no

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
