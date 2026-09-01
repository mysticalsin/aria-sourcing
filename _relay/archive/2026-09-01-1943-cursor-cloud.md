---
project: MSourcing / ARIA
shift: 473
agent: cursor-cloud
updated: 2026-09-01T18:12Z
status: pr-open-coding-gates
---

# Handoff — Shift 473

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** (not merged)
- Leftover **PR #53 OPEN**. Do not touch. Do not merge
- Feature tip (this shift): **`2ecfc57`** — Command Center returning H1 is Aria-shaped, not the campaign title; orbital/blobs in a clipped layer
- Harvest query tip still **`66fb905`**: BA `Calypso Business Analyst`; App Support `Calypso Linux Python`
- Local gate green on `2ecfc57`: `npx tsc --noEmit && npx tsc -p tsconfig.tests.json --pretty false && npm test`
- READY TO MERGE stays **no**. Devon Path-B deploys PR 54 **tip** later
- Polo parked. Overlay/Métis out of scope. Calypso is a **need**. No OAuth. No send. No merge. No Vercel. No Fly from this VM

## Done this shift

1. DESIGN section **Command Center home chrome**: Aria identity, campaign title never H1, clipped decor, no html/body overflow-x hide
2. `ReturningHero` H1 is **Your next move is ready.** Chip `Acting on {title}`. Command bar still uses `nextStep.reason` as context. First-run H1 stays **Paste a job. Aria finds people.**
3. Orbital / blur blobs live in `cc-hero-decor` (`absolute inset-0 overflow-hidden pointer-events-none`). Could not measure 1280/1440 scrollWidth in a browser from this VM — CSS contract is the proof
4. Harvest query and leftover-GitHub strip unchanged

## Blockers

- Official LinkedIn partner search is not wired. Do not complete OAuth. Do not invent candidates
- This VM does not deploy Fly. This VM cannot re-walk live Calypso or screenshot 1280/1440

## Next steps

```bash
# Devon: Path B deploy of PR 54 tip (must include 2ecfc57) onto aria-mantu-app
# Command Center H1 must be Your next move is ready / Aria, not Senior Calypso Business Analyst
# At 1280 and 1440: Command Center root scrollWidth <= clientWidth
# Ultron Source: request_entry query=Calypso Business Analyst
# Query Calypso Business Analysis MySQL is FAIL
# This VM: coding gates only. Do not merge PR 53 or 54
# READY TO MERGE: no
```

## Decisions made (don't relitigate)

- Product name is Aria. Calypso is a client **need**
- Returning Command Center H1 is Aria-shaped. Acting on {title} is chip/subtitle
- Do not hide overflow-x on html/body
- BA harvest query is `Calypso Business Analyst`. App Support stays `Calypso Linux Python`
- Leftover GitHub / `@example.com` are not LinkedIn people
- Devon owns Fly. READY TO MERGE stays no

## Watch out

- Do not invent Fly tokens, candidates, emails, phones, or OAuth
- Do not touch Vercel, Polo, Overlay/Métis, or PR #53
- Do not regress harvest query or leftover-GitHub strip
- Do not start a second slice
- Do not Path-B or Fly-deploy from this VM
