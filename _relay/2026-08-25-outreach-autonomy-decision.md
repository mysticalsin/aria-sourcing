# 2026-08-25 — Outreach autonomy decision (A-4 / A-5 / A-6 / L-7)

**Status:** decided  
**Decider:** Tony Walteur (plan lock)  
**Implemented in:** migrations `0055` / `0056`, `src/lib/autopilot.ts`, `dispatch-outbound.ts`, loop worker shortlist auto path

## Decision

1. **Who:** Admins toggle per-user `profiles.autopilot_enabled`. Workspace
   `sourcing_loop_controls` remains the blast-radius switchboard.
2. **Shortlist (A-4):** Entitled workspaces may auto-enqueue `draft_generate`
   when candidate match score ≥ `auto_shortlist_min_score`. Others keep
   `POST /api/shortlist/approve`.
3. **Send (A-5 / L-7):** Template + audience approval model. Machine may mint
   `approval_source = template_bound` only for entitled approvers and active
   templates. Claim RPCs call `outbound_approval_authorizes_send`.
4. **Replies (A-6):** `decideAutopilot` returns `auto_approve_eligible` only when
   entitlement + guardrails pass and salary/injection/gate checks are clean;
   otherwise `queue` for human review.
5. **LinkedIn:** Defaults to **Automatic** entitled vendor/API delivery
   (`fleet.deliveryMode`). Manual assisted paste/confirm is opt-in.
   Vendor-api still fail-closed until credentials. No scrape/session bots.

## Non-goals

- No LinkedIn scraping / session fleets.
- No silent vendor → assisted-manual fallback.
- Viewers never receive autopilot.
