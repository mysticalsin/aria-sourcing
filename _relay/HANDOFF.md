---
project: MSourcing / ARIA
shift: 469
agent: cursor
updated: 2026-11-20
status: compliance-boundaries-pr-open
---

# Handoff - Shift 469

## Current state

- Branch `twa-odoo` exists on origin at `e3fa3f594a6d86aec31d42a65414a96be4c8400e` (cut from `mbe-branch`, no other commits).
- Compliance work is on `cursor/compliance-boundaries-8b20`, PR targeting `twa-odoo`. Not merged.
- LinkedIn extension, Voyager bridge, pairing token, campaign autopilot (`autopilot.ts`, `campaign-mission.ts`, `tick.ts`), and Claude LinkedIn web search are removed from the tree.
- Migrations `0006`–`0008` are unchanged. `supabase/migrations/0010_drop_linkedin_bridge.sql` drops the bridge tables and `linkedin_bridge_candidate`. It has not been applied to a database in this shift.
- `npm run typecheck`, `npm run typecheck:tests`, and `npm test` exited 0 on this head, including `tests/compliance-boundaries.mts` (5 passed).

## Done this shift

- Created and pushed `twa-odoo` from `e3fa3f59` with no other changes.
- Removed the banned LinkedIn surfaces and disconnected their callers so the suite stays green.
- Added red-first negative tests. On the pre-change tree, `test_no_linkedin_extension_token_path` and `test_no_linkedin_dot_com_egress` failed; vendor, HeyReach, and SmartX checks already passed because those call paths were absent.
- Replaced the AGENTS.md full-autopilot mandate with the factory rules (red-first tests, exact-head review, synthetic data, no merge without a green gate).

## Blockers

- None for this PR. Do not merge until the exact head is reviewed.

## Next steps

1. Review the compliance PR on its exact head. Do not retarget it onto `mbe-branch`.
2. Apply `0010_drop_linkedin_bridge.sql` only in a disposable database. Do not run it against a database that still holds bridge rows you need to export first.
3. PR 2 (approval ledger) is not started. Do not send LinkedIn or email from this tree.
4. HeyReach stays absent until a later PR builds it flag-off, official API only, with a recorded approval.

## Decisions made (don't relitigate)

- Tony, 2026-11-20: `twa-odoo` is cut from `mbe-branch`. Odoo is the system of record. PRs target `twa-odoo`.
- Tony, 2026-11-20: Aria never calls linkedin.com. The extension, cookies, tokens, Voyager, and LinkedIn web-search sourcing are permanently out. Scrapers and enrichment vendors stay out.
- Tony, 2026-11-20: HeyReach may be built later, flag-off, official API only. It is not in this tree. The compliance study still rates it Reject.
- Tony, 2026-11-20: no automation or scraping of `arp.mantu.com`.
- The 2026-11-09 autopilot decision (ADR 0002) and the 2026-11-06 bridge decision are withdrawn on `twa-odoo`. ADR 0002 is marked withdrawn. Do not reimplement them.
- Synthetic data only. No live sends, deploys, or paid calls without Tony's say-so.
- Michael's branches (`mbe-branch`, `mbe-ngrok`, `mbe-test`) were not rewritten.

## Watch out

- `tests/store-contracts.mts` still pins the store action count. This shift did not change that count.
- `0010` drops bridge tables. Old migrations must stay byte-for-byte.
- Profile URL strings (`https://www.linkedin.com/in/...`) may still be stored. That is not a fetch. `tests/compliance-boundaries.mts` fails if a request, extension permission, `allowed_domains`, or `site:linkedin.com` scope returns.
- `_relay/HANDOFF.md` from shift 468 (archived) describes a local password-reset procedure and a real LinkedIn conversation. Do not copy those details into new notes.
- Do not force-push or delete `mbe-branch`, `mbe-ngrok`, `mbe-test`, or `twa-odoo`.
