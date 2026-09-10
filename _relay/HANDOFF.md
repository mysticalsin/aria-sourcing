---
project: MSourcing / ARIA
shift: 129
agent: cursor-cloud
updated: 2026-09-10T17:35Z
status: role-learning-collapsed-tenure-contact-ready
---

# Handoff — Shift 129

## Current state

- **Branch:** `cursor/fly-sourcing-e2e-ready-b91d` @ `93474b5`
- **Fly:** https://aria-mantu-app.fly.dev (redeployed with anon build-arg)
- **Campaign:** `camp_mor1jp00097605_enterprise-windows-desktop-engineer`
- **Next best action (live):** Approve 4 drafts to contact 4 ready candidates
- **Tenure:** Jonah/Patrick/Ivan/Zachary = Contact window (6–10 mo); **Francois Lafond** = Too early
- **Outreach:** 4 LinkedIn drafts Needs Approval
- **Private role learning:** one summary + bulk feedback; 20 searches collapsed behind “Review 20 searches”

## Done this shift

1. Collapsed Private role learning UI
2. Role-tenure gate (block <6 mo; prefer 6–12)
3. Seeded Fly drafts; deferred Francois
4. Playwright-verified password login → campaign → tenure labels → outreach
5. Redeployed with `NEXT_PUBLIC_SUPABASE_ANON_KEY` (empty build-arg briefly broke login; fixed)

## Blockers

1. LinkedIn send still needs Take control / 2FA

## Next steps

1. Open Outreach → Approve drafts for contact-ready candidates
2. Hold Francois until 6–12 months in role
3. Merge PR when ready

## Decisions made (don't relitigate)

- Prefer 6–12 months in current role before outreach; <6 mo blocked
- Aggregate role-learning feedback by default
- Fly showcase uses password login

## Watch out

- Always pass `NEXT_PUBLIC_SUPABASE_ANON_KEY` on Fly deploy build-arg
- Do not put “6–12 month” advisory text into recentActivity before tenure parse
