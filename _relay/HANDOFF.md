---
project: MSourcing / ARIA
shift: 445
agent: cursor-cloud
updated: 2026-08-31T08:42Z
status: pr-open
---

# Handoff — Shift 445

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** against `main` (not merged)
- Tip before this shift: `4cc8a5d` (Fly v165 walk failed Calypso Application Support bar)
- This shift fixes that walk: Skill (Must) tokenize on persist/display; Source next batch is LinkedIn+Apify-first for people-first roles; missing keys fail `MISSING_PLUGIN`; Load Mantu loads Calypso Application Support, not Murex
- Historic CI still red as on main. Quality is the gate. Do not chase historic
- This VM has no `FLY_API_TOKEN`. Did not fake a Fly deploy. Did not merge

## Done this shift

1. Tokenize Skill (Must) on spaces at intake parse/display, JD Analysis chips, `parseSkillList`, `addSkill`, `/api/intake` (`evidenceIntake`), and `deriveValidationWarnings` (blob is not “fewer than 3 skills”)
2. `plannedSourcingSearches` omits GitHub unless the role’s platforms include GitHub (finance → LinkedIn + Apify only)
3. People-first roles (`queryStyle === "linkedin"`) always run the deterministic plan, even when a cloud model is configured. No GitHub 0×3
4. No Tavily and no Apify on a people-first role → `SOURCING_AGENT_NOT_CONFIGURED` / `MISSING_PLUGIN` (connect LinkedIn and/or Apify). Does not search GitHub
5. Live LinkedIn/Apify rows go through `applyLiveEngineGate`: name-only fail, finance floor 60 / cap 20 / per-row CV citations
6. Load Mantu need loads `SAMPLE_CALYPSO_APP_SUPPORT_NEED`. Will not overwrite an already-loaded Calypso Application Support brief with Crédit Agricole Murex. Murex is a separate “Load Murex sample” button
7. Tests extended in existing suites. `tsc --noEmit` green on this change

## Blockers

- Protected Fly release must land this branch before Ultron can re-walk v165+
- LinkedIn OAuth / Apify still fail-closed without workspace keys
- No Fly token here

## Next steps

```bash
# Devon: Path B protected Fly release of cursor/sourcing-engine-94b1 → aria-mantu-app
# Ultron: walk Calypso Application Support on the new SHA
#   JD Analysis: Skill (Must) is separate chips (Linux, Python, Shell, …)
#   Source next batch: LinkedIn + Apify when keyed; MISSING_PLUGIN if not
#   Name-only Calypso Martinez still fails; per-row CV citations on kept rows
#   Load Mantu need stays Calypso Application Support
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
- Load Mantu need is the Calypso Application Support VSS, not the Murex sample

## Watch out

- Do not invent Fly tokens
- Do not touch Vercel or Polo or PR #53
- `campaign-actions.ts` runtime imports stay `import {` + `evaluateNeedReadiness` only
- Engine must not import `@/lib/utils`
- Do not import `src/lib/sourcing/engine.ts` from client `sourcing-actions.ts` or `sourcing-helpers.ts`
- `applyLiveEngineGate` is server-only (`live-shortlist.ts`)
