---
project: MSourcing / ARIA
shift: 469
agent: cursor-grok
updated: 2026-11-20
status: design-system-gallery
---

# Handoff - Shift 469

## Current state

- Branch `cursor/aria-design-system-9f02`, cut from `twa-odoo` at `e3fa3f59`. Not merged.
- New code is only the design system plus a standalone gallery route. Existing console pages do not import it.
- Gallery: `/design-system`. Full-bleed (same public-path treatment as careers). Not in `src/components/app/nav.ts`.
- Gate on this shift: `npm run typecheck && npm run typecheck:tests && npm test` exit 0.
- Synthetic fixture data only (`@example.test`). No secrets.

## Done this shift

- Read-only inventory of mysticalsin/vision `d9e049a9`, mysticalsin/athena `8270672e`, mysticalsin/bidstack-360 `0ddf0a52` (Polo). Azure DevOps `VibeApps/manager-cards` was not readable: `core_list_projects` and `search_code` timed out (`MCP -32001`) while the namespace reported ready. Nothing was copied from it.
- Added `src/design-system/` (tokens, theme, primitives, charts, KPI cards, candidate card, pipeline kanban, approval panel, Odoo sync chip, gallery). Attribution and the inventory table: `src/design-system/ATTRIBUTION.md` and `src/design-system/inventory.ts`.
- Tests: `tests/design-system.mts` (contrast, manual default, exact-text SHA-256, Hired gate, keyboard labels) and `tests/design-system-visual.mts` (Playwright screenshots and tab focus). Both are in the application group of `tests/test-manifest.mjs`.

## Blockers

- None for this gallery. Manager-dashboard components from Azure DevOps remain unread.

## Next steps

1. A later PR may adopt `src/design-system` inside the existing console pages. Do not start that inside this branch.
2. If Azure DevOps answers, inventory `VibeApps/manager-cards` and only then decide whether a card from it should be adapted.
3. Keep Manual as the default send mode. Hired stays gated.

## Decisions made (don't relitigate)

- Owner 2026-11-12 (shift 466): the presentation shows the "POC live". Pages that need an integration this install does not run are left out of the navigation, not deleted: `OUT_OF_POC_SCOPE` in `src/components/app/nav.ts`.
- Shift 466: a LinkedIn message recorded as sent (bridge or confirmed manual copy) is a real send (`dryRun: false`); the dry-run switch is email only.
- Owner 2026-11-09 (shift 463/464), ADR 0002: an `agents` Compose service is allowed. The campaign autopilot may queue LinkedIn invitations from the owner's paired account under a standing approval. This design-system PR does not change that code.
- Owner 2026-11-06: Apify stays retired. No stealth scraping.
- Owner 2026-11-03: no "hermes" in the code. Vercel is dropped. Kong replaced by Caddy. No local LLM.
- UX: English UI, Carlito, Mantu colours. This gallery keeps those and does not import Polo's brand blue `#2c4bff` (Polo ADR 0002).
- Tony, 20 Nov 2026, via the build plan: default send mode is Manual. Full automatic is an opt-in toggle. The approval panel shows one exact message. Live send is not wired here.
- This shift: the design system is a new directory. It is not mounted on the existing pages.

## Watch out

- `/design-system` is public in `src/proxy.ts` so the gallery renders without a session. It must stay synthetic.
- Yellow `#F8F060` is a button fill with navy text. It is not small body text.
- Hired cannot be entered from the gallery kanban. The block string is `HIRED_BLOCK` in `src/design-system/pipeline/stages.ts`.
- `EXACT_OUTREACH_SHA256` must match `EXACT_OUTREACH_MESSAGE`. `tests/design-system.mts` checks it.
- Playwright screenshots from `tests/design-system-visual.mts` need Chromium (`playwright install chromium`). They are written to `/opt/cursor/artifacts`, not the repo.
- Do not push to `mbe-branch`, `mbe-ngrok`, or `mbe-test`.
- Carried from shift 468 (still true on this base): empty `AGENTS_LINKEDIN_ALLOWLIST` before any real autopilot; the local stack holds the owner's real LinkedIn data, so never `DELETE /api/linkedin/account` as `admin@aria.local`; `tests/store-contracts.mts` pins 118 store actions; `useSlice` selectors must return a stable reference; `tests/module-boundaries.mts` rejects type-only cycles; `tests/motion-foundation.mts` greps `providers.tsx` for `framer-motion`.
