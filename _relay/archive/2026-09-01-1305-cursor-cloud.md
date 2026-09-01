---
project: MSourcing / ARIA
shift: 459
agent: cursor-cloud
updated: 2026-09-01T01:08Z
status: pr-open-coding-gates
---

# Handoff — Shift 459

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** (not merged)
- Leftover **PR #53 OPEN**. Do not touch. Do not merge
- Feature tip: **`c4c655f`** — connect → source → outreach; toast CTA; honor valid Apify key; domain verify; keyed empty harvest fail-loud
- Live Fly walk baseline remains SHA `6fd7e3f3f583` until Devon Path-B deploys this tip
- Local gate green on `c4c655f`: `npm run typecheck && npm run typecheck:tests && npm test`
- READY TO MERGE stays **no** until a keyed LinkedIn+Apify shortlist on Fly
- Polo parked. Calypso is a **need**, not a product name

## Done this shift

1. DESIGN.md already had connect → source → outreach (from `c0eecbb`). Did not relitigate
2. Fail-loud toasts now have **Open Access & Keys** CTA (`toast-cta`). `MISSING_PLUGIN` is not the product path
3. Valid Apify Access & Keys row **is** harvest. A Live card without a valid key is not. `Apify (sourcing)` label still counts
4. Integrations merge + `applyHarvestKeysToIntegrations` marks Apify/HeyReach connected when keys are valid
5. Apify modal: `data-autofocus`, immediate first poll, loud empty/timeout error
6. Outlook send needs Fleet Graph **and** Verify domain. `example.com` / `@fixture.example` cannot send
7. HeyReach is the LinkedIn sender in Quick Draft / outreach card when the key is valid. Still dry-run until approve
8. Unkeyed people-first Source next batch uses fixture dry-run, not a toast wall
9. Keyed GitHub-only empty harvest is `EMPTY_PEOPLE_FIRST_HARVEST`, not `MISSING_PLUGIN`
10. Email allocation capacity ignores LinkedIn/WhatsApp/SMS seats

## Blockers

- Official LinkedIn partner search is not wired. Do not complete OAuth from a VM. Do not invent candidates
- Keyed live shortlist still requires the stored Apify/LinkedIn key on Fly. Do not upgrade Apify from here
- Devon Path-B deploys after these tests. This VM does not deploy Fly

## Next steps

```bash
# Devon: Path B deploy of PR 54 tip c4c655f onto aria-mantu-app. Do not wait here
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
- Official LinkedIn search is concept/honest. Fleet OAuth is identity/messaging
- Outlook send is Fleet Graph + Verify domain. Inbox SMTP is ingest
- HeyReach is LinkedIn send, not people search
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
