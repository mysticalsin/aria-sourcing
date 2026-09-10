---
project: MSourcing / ARIA
shift: 129
agent: cursor-cloud
updated: 2026-09-10T17:20Z
status: role-learning-collapsed-tenure-contact-ready
---

# Handoff — Shift 129

## Current state

- **Branch:** `cursor/fly-sourcing-e2e-ready-b91d`
- **Fly:** https://aria-mantu-app.fly.dev — Windows Desktop campaign toward contact
- **Campaign:** `camp_mor1jp00097605_enterprise-windows-desktop-engineer`
- **Candidates (5):** 4 contact-ready LinkedIn drafts (Needs Approval); **Francois Lafond** deferred (<6 mo / just started)
- **Tenure gate:** `src/lib/sourcing/role-tenure.ts` — block outreach when <6 mo in role; prefer 6–12 mo
- **Private role learning:** collapsed to one summary line + bulk Useful/Dead end/Needs correction; per-search rows behind expand

## Done this shift

1. Collapsed crowded Private role learning UI (`campaigns/[id]/page.tsx`)
2. Added role-tenure inference + approval block + auto-draft skip
3. Candidate table shows "Too early" / "Contact window" hints
4. Seeded Fly outreach drafts via `scripts/prepare-fly-windows-contact-drafts.mjs`
5. Next-best-action copy points at approving drafts to contact

## Blockers

1. LinkedIn send still needs Take control login/2FA on computers
2. Deploy tip after commit so UI collapse + tenure badges are live

## Next steps

1. Hard refresh → password login → Enterprise Windows Desktop Engineer
2. Confirm Private role learning is one summary (not N rows)
3. Candidates: Francois shows Too early; others Contact window
4. Outreach tab: 4 drafts Ready → Approve to contact
5. Merge PR when ready

## Decisions made (don't relitigate)

- Prefer 6–12 months in current role before outreach; <6 mo is blocked
- Aggregate role-learning feedback by default; expand only when needed
- Fly showcase uses password login, not demo-login one-click

## Watch out

- Do not put "6–12 month" advisory text into `recentActivity` before tenure parse (fixed: start→Present wins)
- Stale empty browser tab can overwrite workspace_state candidates/outreach
