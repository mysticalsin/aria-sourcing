---
project: MSourcing / ARIA
shift: 460
agent: cursor-cloud
updated: 2026-09-01T13:05Z
status: pr-open-coding-gates
---

# Handoff — Shift 460

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** (not merged)
- Leftover **PR #53 OPEN**. Do not touch. Do not merge
- Feature tip: **`38fbcec`** — invalid-agent recovery CTA + honest LinkedIn Sourcing / HeyReach
- Lint/copy tip: **`910f164`** (branch HEAD)
- Live Fly Path B is still **`200b548`**. Ultron re-walk recorded P0-1 Dismiss-only invalid-response and P0-5 LinkedIn API-key paste on that SHA
- Local gate green on `910f164`: `npm run typecheck && npm run typecheck:tests && npm test`
- READY TO MERGE stays **no** until Devon deploys this tip and a keyed harvest is proven on Fly
- Polo parked. Calypso is a **need**, not a product name

## Done this shift

1. DESIGN.md: invalid-agent fail gets Open Access & Keys; LinkedIn Sourcing/RSC is not API-key paste and not Fleet partner search; HeyReach is not a fake Live send account
2. Live P0-1 cause: `/api/sourcing-agent` `500 text/plain` from Playwright/tool-loop import. People-first route no longer statically imports tool-loop. Remaining keyed fails remap to `PEOPLE_FIRST_HARVEST_UNAVAILABLE` with toast-cta
3. LinkedIn Sourcing + RSC are concept cards (`setupHref: /settings`, Access & Keys). Leftover stored LinkedIn Sourcing cards are rewritten. No Configure API-key paste. Fleet is not labeled partner search
4. HeyReach key is the LinkedIn send account for drafts only. Card is not Live/Connected; no Live toggle; no campaign/sender console
5. Tests pin both holes in `integrations-honesty`, `sourcing-agent-contract`, `store-sourcing-actions`

## Blockers

- Official LinkedIn partner search is not wired. Do not complete OAuth from a VM. Do not invent candidates
- Fly is still on `200b548` until Devon Path-B deploys `910f164`
- This VM does not deploy Fly

## Next steps

```bash
# Devon: Path B deploy of PR 54 tip 910f164 onto aria-mantu-app. Do not wait here
# Ultron: re-walk Source next batch on Calypso Application Support after that SHA
# This VM: coding gates only. Do not merge PR 53. Do not merge PR 54
# READY TO MERGE: no until a keyed LinkedIn+Apify shortlist on Fly
# Do not touch Vercel. Do not complete LinkedIn or Microsoft OAuth from a VM
# Do not invent candidates. Never auto-send
```

## Decisions made (don't relitigate)

- Product name is Aria. Calypso is a client **need**
- One coding PR (#54). Leftover #53 stays open and unmerged
- Access & Keys is the source of truth for Apify harvest. Do not ask to reconnect a valid key
- Unkeyed people-first is Connect + fixture dry-run, not a `MISSING_PLUGIN` wall
- Official LinkedIn search is concept/honest. Fleet OAuth is identity/messaging, not partner search
- LinkedIn Sourcing Configure is never an API-key paste
- Outlook send is Fleet Graph + Verify domain. Inbox SMTP is ingest
- HeyReach is LinkedIn send key for drafts, not a fake Live/Connected send account
- Send stays dry-run until channel-connect **and** Tony approves that send
- Devon owns Fly. This agent does not deploy and does not ask for `FLY_API_TOKEN`
- READY TO MERGE stays no until a keyed LinkedIn+Apify shortlist

## Watch out

- Do not invent Fly tokens or ask for them
- Do not invent candidates
- Do not complete OAuth from this VM
- Do not touch Vercel, Polo, or PR #53
- `campaign-actions.ts` runtime imports stay `import {` + `evaluateNeedReadiness` only
- Engine must not import `@/lib/utils`
- Do not import `src/lib/sourcing/engine.ts` from client `sourcing-actions.ts` or `sourcing-helpers.ts`
- Do not put `@fixture.example` in `sourcing-actions.ts`
- `applyLiveEngineGate` is server-only (`live-shortlist.ts`)
- Manifest freeze: extend existing suites, do not add new suite files
- Hooks before early return in Source via Apify stays
