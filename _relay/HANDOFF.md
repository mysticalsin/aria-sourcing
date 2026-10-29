---
project: MSourcing / ARIA
shift: 447
agent: claude-code
updated: 2026-10-29
status: ux-audit-in-progress-login-uncommitted-gate-blocked-by-host-load
---

# Handoff - Shift 447

## Current state

- Branch mbe-branch. Local commits NOT yet pushed: 93b73347 (UI/UX audit spec)
  and f2765db0 (overflow fixes, gate green when committed: typecheck,
  typecheck:tests, npm test 240 pass / 0 fail).
- Owner asked for a full UI/UX audit and a polished UX BEFORE any AI integration.
  Audit: .scratch/ui-ux-audit/spec.md (French), one issue per work package in
  .scratch/ui-ux-audit/issues/01..10. 01 and 03 resolved; 02, 04-10 ready-for-agent.
- UNCOMMITTED in the working tree (work package 03, login + credit):
  src/app/login/page.tsx (rewritten), src/components/app/sidebar.tsx,
  src/components/app/logo.tsx (comment), src/components/ui/button.tsx
  (justify-center), src/styles/globals.css (login-only CSS + --font-garamond
  removed), tests/login-page.mts and tests/font-build.mts (contract updated),
  .scratch/ui-ux-audit/{spec.md,issues/03-login.md}. Typecheck and
  typecheck:tests pass on it. Visually checked at 1440 and 390 px in local mode
  and with NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true.
- AGENTS.md is modified in the working tree by another tool; not touched or
  committed by Claude Code. Its owner should review/commit it.

## Done this shift

1. Captured 21 routes at 1440x900 and 390x844 against the synthetic demo (Edge
   via Playwright, onboarding flag hermes:onboarded:v1 preset), with automated
   overflow detection; traced metric definitions in code. Wrote the audit.
2. Owner decisions recorded in spec (see below).
3. Overflow fix (f2765db0): sr-only spans (position:absolute) inside unpositioned
   overflow-x containers escaped clipping (home was 3708 px wide); made
   containers relative (integration strip, ui/Table, funnel kanban). Added a
   grid-cols-1 base to 81 breakpoint-only grids. All 42 captures fit.
4. Login redesign (uncommitted, see above): form visible without a click, no
   third-party CloudFront video, no personal credit, Mantu Group mention,
   desktop ink panel with the 3-step approval sequence (Mantu-yellow human step).

## Blockers

- npm test exits 1 ONLY on tests/acceptance-campaign-dry-run.mts: spawnSync of
  scripts/acceptance-campaign-dry-run.sh returns status null (killed by its
  30_000 ms timeout) during "Cleaning the marked ephemeral acceptance tenant".
  Cause is host load, not the change: 50 trivial `date` spawns took 22 s, then
  >120 s (normal ~1 s). The test uses a mock HTTP server, none of the changed
  files. It passed in the same session before the load spike (240/0).

## Next steps

1. When process spawning is normal again (`time bash -c 'for i in $(seq 1 50);
   do date >/dev/null; done'` under ~2 s), run
   `npm run typecheck && npm run typecheck:tests && npm test`. If green, commit
   the uncommitted login package as "feat(ui): replace cinematic login with a
   sign-in screen" (exclude AGENTS.md), then push mbe-branch and check CI.
2. Continue the audit packages in order: 02 metric labels, 07 tour scope,
   05 work queues first, 06 candidate table, 04 navigation, 08 vocabulary,
   09 visual system, 10 careers. Each: gate + re-capture of affected routes at
   1440/390 with scrollWidth <= viewport.
3. Node is not on Git Bash PATH here; use the portable runtime:
   `export PATH="/c/Users/michael.bernard_amar/AppData/Local/Temp/aria-node-runtime/node-v22.23.4-win-x64:$PATH"`.

## Decisions made (don't relitigate)

- UI language: English everywhere; "#Vivier" becomes "Talent pool".
- Navigation regrouped as in spec section 4; Intake + Launch merge into one
  "New campaign"; old URLs redirect.
- Candidate rating: a single /100 score; Top Gun / A-D letters / stars removed
  from screens.
- No personal credit (Tony Walteur) anywhere in the UI; use a Mantu Group mention.
- Calibri is the Mantu brand font: keep it, self-host Carlito for consistency
  (package 09), do not switch typeface.
- KPI "0 contacted" vs funnel "35" is not a calculation bug: realFunnelFacts
  counts real sends only. Fix is labelling (package 02), not the math.
- Plus every decision from shift 446 (archive 2026-10-29-1300-claude-code.md):
  no secrets in Git/relay, no paid calls, no Docker/WSL install, no auto retry.

## Watch out

- Removing tests' old assertions (video pause, email disclosure) was deliberate:
  the video and disclosure no longer exist. Security assertions were kept.
- ui/Button now centers content; full-width buttons elsewhere change alignment
  (intended: fleet seat cards, integration cards, overlay).
- Supabase/Azure login mode was not rendered (needs a backend); verify on the
  other machine that "Sign in with Microsoft" and the email form both show.
- scripts/accept-local-demo.mjs uses getByLabel("Username or email") and
  getByLabel("Password", { exact: true }); the new labels keep those exact names.
