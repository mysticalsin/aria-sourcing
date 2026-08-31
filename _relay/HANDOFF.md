---
project: MSourcing / ARIA
shift: 442
agent: cursor-cloud
updated: 2026-08-31T07:45Z
status: pr-open
---

# Handoff — Shift 442

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** against `main` (not merged)
- Product tip `a5688da` (`fix(intake): tokenize VSS Skill (Must) and stamp the git SHA`) plus follow-up relay/DESIGN/evidence on this shift
- Local gate: `./node_modules/.bin/tsc --noEmit` pass; `npm test` pass
- **Fly is not this PR.** Live last documented: `d9e8cd0` on `main` (PR 51). Ultron walk on https://aria-mantu-app.fly.dev/ was old host
- This VM has no `FLY_API_TOKEN`. Did not fake a Fly deploy. Did not merge

## Done this shift

1. Tokenize VSS Skill (Must) on spaces (`tokenizeMustHaveSkills`). One chip `Linux Python Shell…` cannot persist
2. Recover Middle 4–6 → Mid min 4 max 6, Montreal, Hybrid, English (labeled or unlabeled)
3. `parseIntakeLive` skips cloud when VSS has title + ≥2 skills or is ready; failed Hermes does not banner a ready brief; cloud cannot shrink a split skill list
4. GitHub `language:` only for real languages. Unsplit blob never becomes `language:LinuxPython…`
5. Calypso / application-support role family is finance → LinkedIn then Apify (not GitHub-first)
6. UI build stamp `aria <sha>` on login + sidebar; Docker/CI bake `NEXT_PUBLIC_ARIA_GIT_SHA` from `ARIA_RELEASE_SHA` / `GITHUB_SHA`
7. DESIGN.md: tokenize, multi-source, LinkedIn primary, in-product sequences, dry-run until approve, no AI disclosure
8. Extended `tests/mantu-intake.mts`, `tests/intake-grounding.mts`, `tests/roles-i18n.mts`, `tests/login-page.mts`

## Blockers

- Protected Fly release must land this branch before Ultron can walk the new parser/engine
- Historic required checks still fail as on main (do not chase)
- LinkedIn product OAuth / RSC credentials are not on this VM — connect stays fail-closed until Devon/Tony wire official credentials
- No Fly token here

## Next steps

```bash
# Devon: Path B protected Fly release of cursor/sourcing-engine-94b1 → aria-mantu-app
# Ultron: walk https://aria-mantu-app.fly.dev/ and confirm sidebar/login shows aria <sha> matching 54
# Parse JD on Tony AMACAN VSS: split skills, Mid 4-6, Montreal, no cloud-miss banner, Create campaign unblocked
# Source: LinkedIn boolean uses per-skill OR; GitHub has language:Python not language:LinuxPython…
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

## Watch out

- Do not invent Fly tokens
- Do not touch Vercel or Polo or PR #53
- `campaign-actions.ts` runtime imports stay `import {` + `evaluateNeedReadiness` only
- Engine must not import `@/lib/utils`
