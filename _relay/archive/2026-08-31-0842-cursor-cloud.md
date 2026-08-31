---
project: MSourcing / ARIA
shift: 444
agent: cursor-cloud
updated: 2026-08-31T08:10Z
status: pr-open
---

# Handoff — Shift 444

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** against `main` (not merged)
- Tony addendum: LinkedIn primary not exclusive; official product OAuth; agent-built in-product sequence
- Fly is not this PR. Live last documented: `d9e8cd0` on `main` (PR 51)
- Historic CI (secret scan, dep audit, db-security, supply chain, release gate) still red as on main. Quality is the gate we keep green. Do not chase historic.
- This VM has no `FLY_API_TOKEN`. Did not fake a Fly deploy. Did not merge

## Done this shift

1. DESIGN.md: after Source next batch / Run sourcing agent, Aria drafts first-touch for the shortlist (score ≥ 60, cap 20) into Needs Approval. HeyReach 0-account HOLD is not a skip
2. Live `sourceNextBatch` now queues dry-run first-touch drafts (`Needs Approval`, `sentAt` null) for reviewed people at/above the 60 floor. Below-floor rows get no draft. Never auto-send
3. Test in `tests/store-sourcing-actions.mts`. `tsc --noEmit` green

## Blockers

- Protected Fly release must land this branch before Ultron can walk it
- LinkedIn OAuth fail-closes without `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` on this VM
- No Fly token here

## Next steps

```bash
# Devon: Path B protected Fly release of cursor/sourcing-engine-94b1 → aria-mantu-app
# Ultron: walk Fly; Connect LinkedIn is Fleet → LinkedIn Vendor API → official OAuth
# Source next batch: LinkedIn + Apify, then dry-run drafts in Outreach Needs Approval
# Do not merge PR 54
# Do not fake flyctl deploy
```

## Decisions made (don't relitigate)

- Product name is Aria. Calypso is a client **need**
- One PR (#54). READY TO MERGE stays no
- Shortlist floor 60, cap 20, name-only fail, per-row citations
- LinkedIn is primary, not exclusive; Apify + keyed sources still required
- Outreach dry-run until Tony approves a send. Never auto-send. Never identify as AI
- HeyReach 0-account HOLD is not a skip — sequences are in-product
- Quality stays green; do not put FLY_API_TOKEN on Quality
- Do not add Apify to the SQL learning platform check without a migration

## Watch out

- Do not invent Fly tokens
- Do not touch Vercel or Polo or PR #53
- `campaign-actions.ts` runtime imports stay `import {` + `evaluateNeedReadiness` only
- Engine must not import `@/lib/utils`
- Do not import `src/lib/sourcing/engine.ts` from client `sourcing-actions.ts`
