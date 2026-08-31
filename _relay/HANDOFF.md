---
project: MSourcing / ARIA
shift: 443
agent: cursor-cloud
updated: 2026-08-31T07:50Z
status: pr-open
---

# Handoff — Shift 443

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** against `main` (not merged)
- This shift wires live Source next batch to LinkedIn + Apify (not GitHub-only)
- Fly is not this PR. Live last documented: `d9e8cd0` on `main` (PR 51)
- This VM has no `FLY_API_TOKEN`. Did not fake a Fly deploy. Did not merge

## Done this shift

1. `plannedSourcingSearches` (`src/lib/sourcing/multi-source-plan.ts`): LinkedIn boolean first, then Apify (title + tokenized skills), then only useful GitHub (`language:` must be a real GitHub language)
2. Deterministic `/api/sourcing-agent` runs that plan (Tavily + Apify keys resolved even without a cloud model)
3. `search_candidates` enum includes Apify; harvestapi start+poll via `runProfileSearchAndWait`; no key → fail-closed
4. Learning receipts remap Apify → LinkedIn (SQL allow-list unchanged; no migration)
5. Hermes chat runner gets the stored Apify token
6. DESIGN.md: deterministic Source next batch is LinkedIn + Apify first, not GitHub-only Calypso
7. Tests extended in existing suites (`mantu-intake`, `sourcing-agent`, `sourcing-agent-route-authority`, `hermes-cloud-authority`)

## Blockers

- Protected Fly release must land this branch before Ultron can walk multi-source on https://aria-mantu-app.fly.dev/
- Historic required checks still fail as on main (do not chase)
- LinkedIn product OAuth / RSC credentials are not on this VM — connect stays fail-closed until Devon/Tony wire official credentials
- No Fly token here

## Next steps

```bash
# Devon: Path B protected Fly release of cursor/sourcing-engine-94b1 → aria-mantu-app
# Ultron: walk Fly; sidebar/login shows aria <sha> matching 54
# Parse JD on Tony AMACAN VSS: split skills, Mid 4-6, Montreal, no cloud-miss banner
# Source next batch: LinkedIn boolean + Apify harvestapi, not language:LinuxPython…
# Outreach stays dry-run until Tony approves a send
# Do not merge PR 54 from this agent
# Do not fake flyctl deploy
```

## Decisions made (don't relitigate)

- Product name is Aria. Calypso is a client **need**
- One PR (#54). READY TO MERGE stays no. Do not merge yourself
- Shortlist floor 60, cap 20, name-only fail, per-row citations
- LinkedIn is primary, not exclusive; Apify + keyed sources still required
- Outreach dry-run until Tony approves a send. Never auto-send. Never identify as AI
- HeyReach 0-account HOLD is not a skip — sequences are in-product
- Quality stays green; do not put FLY_API_TOKEN on Quality
- Fly proof is a protected release, not a VM/laptop deploy
- Do not add Apify to the SQL learning platform check without a migration

## Watch out

- Do not invent Fly tokens
- Do not touch Vercel or Polo or PR #53
- `campaign-actions.ts` runtime imports stay `import {` + `evaluateNeedReadiness` only
- Engine must not import `@/lib/utils`
- `makeSourcingToolRunner` 8th arg is `apifyToken`; do not shift existing positional callers
