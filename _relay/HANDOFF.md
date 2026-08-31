---
project: MSourcing / ARIA
shift: 455
agent: cursor-cloud
updated: 2026-08-31T11:07Z
status: pr-open
---

# Handoff — Shift 455

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** against `main` (not merged)
- Feature tip for Path B: **`cc1ac19`** — split GitHub `language:` queries into Skill (Must) tokens
- Docs tip after this baton will sit above `cc1ac19`. Path B the **feature** SHA, not the later `docs(relay)` commit
- Ultron Fly walk of v171 / `283def2` PASSed skills chips, learning panel (no GitHub 0-rows), Source next batch `MISSING_PLUGIN` toast, LinkedIn Configure present not clicked. Leftover caveat was glued `language:LinuxPythonShellOracleGrafanaDynatraceLinuxServer` on the Strategy tab
- Local gate green on `cc1ac19`: `npm run typecheck && npm run typecheck:tests && npm test`
- Historic CI still red as on main. Quality is the gate. Do not chase historic
- READY TO MERGE stays **no** until a keyed LinkedIn+Apify shortlist (Tony lock)
- This VM has no `FLY_API_TOKEN`. Did not fake a Fly deploy. Did not invent candidates. Did not complete OAuth. Did not touch Vercel

## Done this shift

1. `splitGluedSkillBlob` splits CamelCase Skill (Must) blobs into the same chips as a space-separated line (`Linux`, `Python`, `Shell`, `Oracle`, `Grafana`, `Dynatrace`, `Linux Server`)
2. `githubSkillQueryToken` tokenizes first and never compact-joins spaces into `language:LinuxPython…`
3. `repairGithubQueries` / `honestGithubQueries` rebuild a stale glued query as separate language or topic tokens
4. Hydrate (`normalizeHermesState` + `migrateToCurrentVersion`) and the campaign Strategy tab render repaired queries, not the raw persisted blob

## Blockers

- Devon Path B of **`cc1ac19`** onto `https://aria-mantu-app.fly.dev/` before Ultron re-walks the Strategy tab
- Official LinkedIn partner search is not wired; Apify is the people source that unblocks a keyed shortlist
- No Fly token here

## Next steps

```bash
# Devon: Path B protected Fly release of cursor/sourcing-engine-94b1 (cc1ac19) → aria-mantu-app
# Ultron: walk Calypso Application Support on cc1ac19 at https://aria-mantu-app.fly.dev/
#   Strategy GitHub query must NOT be language:LinuxPythonShellOracleGrafanaDynatraceLinuxServer
#   Must show separate tokens: language:Python / language:Shell or topic terms (Linux, Oracle, …)
#   Skills chips, learning panel, MISSING_PLUGIN toast, LinkedIn Configure must stay PASS
# Do not merge PR 54
# READY TO MERGE: no until a keyed LinkedIn+Apify shortlist
# Do not touch Vercel
# Do not complete LinkedIn OAuth from a VM
# Do not invent candidates
```

## Decisions made (don't relitigate)

- Product name is Aria. Calypso is a client **need**
- One PR (#54). READY TO MERGE stays no until a keyed LinkedIn+Apify shortlist
- Fly only: `https://aria-mantu-app.fly.dev/`. No Vercel. No demo deploys. No second implementer
- Quality is the gate. Historic CI red matches main
- Shortlist floor 60, cap 20, name-only fail, per-row citations
- LinkedIn is primary, not exclusive; Apify + keyed sources still required
- Tavily is web search, not LinkedIn Sourcing
- GitHub Sourcing Live while unconfigured is not a people source
- GitHub `language:` uses Skill (Must) tokens separately, never one glued word
- Outreach dry-run until Tony approves a send. Never auto-send. Never identify as AI
- Do not put FLY_API_TOKEN on Quality
- Do not add Apify to the SQL learning platform check without a migration
- Load Mantu need is the Calypso Application Support VSS, not the Murex sample

## Watch out

- Do not invent Fly tokens
- Do not invent candidates
- Do not complete OAuth from this VM
- Do not touch Vercel or Polo or PR #53
- `campaign-actions.ts` runtime imports stay `import {` + `evaluateNeedReadiness` only
- Engine must not import `@/lib/utils`
- Do not import `src/lib/sourcing/engine.ts` from client `sourcing-actions.ts` or `sourcing-helpers.ts`
- `applyLiveEngineGate` is server-only (`live-shortlist.ts`)
- `vss-need.ts` must not import `github-search-language.ts` (cycle)
