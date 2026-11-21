---
project: MSourcing / ARIA
shift: 469
agent: cursor
updated: 2026-11-21
status: c2a-a11y-fixed
---

# Handoff - Shift 469

## Current state

- Branch `cursor/aria-c2a-a11y-ux` off `twa-odoo` @ `e3fa3f59`. Red-first test commit `76d192d1`. Product fix follows it.
- `npx tsc --noEmit`, `npx tsc -p tsconfig.tests.json --noEmit`, and `npm test` passed locally after the fix.
- Playwright + axe-core (WCAG 2.2 AA) on the local synthetic demo (`npm run dev`, no Supabase): 23 console routes at 1440, 768, and 375 have 0 serious and 0 critical violations. Before the fix, every route had at least one.
- Nothing was sent. The sweep only navigated localhost.

## Done this shift

- C2A-01: `--success` 31.4%, `--danger` 46.6%, `--violet` 51%, `--warning` 31.3%. Hue and saturation unchanged. Badge warning text uses the warning token.
- C2A-02: reduced motion now stops `.animate-spin-slow`.
- C2A-03 / C2A-04: tour copy no longer says Aria finds people on LinkedIn. A populated demo (17 messages waiting in `buildSeedState`) gets a demo-aware step 1. Empty workspaces still start from a job brief.
- C2A-05: `#main-content` is `tabIndex={-1}` and the skip link focuses it.
- C2A-06: search, user menu, and campaign cards no longer override their visible names.
- C2A-07: Manual add is disabled in the demo, with an inline explanation. The action error names the live-workspace step.
- C2A-09: Settings tab rail wraps. The tab label is `Mailboxes`, matching `nav.ts`.
- C2A-10: `/skills` renders a `TabPanel` for each `aria-controls` id.
- C2A-11: `Progress` requires an accessible name. Interviewer bars are named.
- C2A-12: the confidential mark is `role="img"`.
- C2A-13: the blocking loader says "Loading the synthetic demo".
- Resting contrast: handled reply cards, closed pipeline rows, score suffixes, and the learning-session action row no longer fade text with opacity.

## Blockers

- None in this diff.
- Base `twa-odoo` @ `e3fa3f59` CI run https://github.com/mysticalsin/aria-sourcing/actions/runs/44824720933 fails Secret scan, Local Docker demo, and Release gate. Those jobs are unchanged here.

## Next steps

1. Review the draft PR. Do not merge.
2. When #168, #177, and #178 land, keep their LinkedIn, HeyReach, and token strings aligned with the tour sentence in `src/lib/command-center-firstrun.ts` (`LINKEDIN_BOUNDARY`). This branch does not edit those files.
3. Re-run `npx tsx tests/a11y-c2a-playwright.mts` against `npm run dev` if the palette or the tour changes.

## Decisions made (don't relitigate)

- Shift 469: color tokens move only as far as WCAG 2.2 AA 4.5:1. Success 31.4, danger 46.6, violet 51, warning 31.3. Same hues.
- Shift 469: the first-run tour on a populated workspace describes the waiting queue. It states that Aria does not automate or scrape LinkedIn, that candidates come from sanctioned sources, that the token channel is off unless an admin enables it, and that HeyReach is off by default.
- Shift 469: Settings calls the fleet tab Mailboxes, the same name as the nav.

- Owner 2026-11-12 (shift 466): the presentation shows the "POC live". Pages that need an integration this install does not run are left out of the navigation, not deleted: `OUT_OF_POC_SCOPE` in `src/components/app/nav.ts`. Empty the set to bring them back.
- Shift 466: a LinkedIn message recorded as sent (bridge or confirmed manual copy) is a real send (`dryRun: false`); the dry-run switch is email only.
- Owner 2026-11-12: the demo campaign is wiped; a new one will be prepared for the presentation. The Reports ROI stays and the demo script explains it is an extrapolation for the demo.
- Owner 2026-11-12: the untested features are to be validated without messaging real people. Autopilot demos and tests run with `AGENTS_LINKEDIN_ALLOWLIST` set (on this Mac: Tony's profile only).
- Shift 466: the scoring rule stays (unknown requested dimension = 30), so a public search result alone cannot reach the 70 floor. The way up is the recruiter's "Verify the profile" form (drawer, Evidence tab).
- Owner 2026-11-09 (shift 463/464), ADR 0002 (`docs/adr/0002-agents-runner.md`): an `agents` Compose service is allowed (amends ADR 0001). The campaign autopilot may queue LinkedIn invitations/messages WITHOUT a click per message, from the campaign owner's own paired account, under a standing approval the owner signs per campaign. POC goal: "is it possible", owner accepts the account risk. Sender = the autopilot owner (the user who turned it on); each user pairs their own LinkedIn.
- Owner 2026-11-09: VM POC (B3) = real visible Chrome, one profile per user, each user signs in to LinkedIn there themselves. NO session-cookie copy, NO proxies / fingerprint changes / random delays (re-confirmed). App and agents run on a server; the VM is only for the browsers.
- Owner 2026-11-09: higher AI budget is fine. GDPR for algorithm-decided contacts: "later, the project is not ready" (do not block on it).
- Owner 2026-11-09 (shift 462): approving a LinkedIn outreach message is the human decision to send it: approval queues it on LinkedIn (no separate "manual send" or send click). Still never automatic: nothing queues a LinkedIn write without a person's click (approval, Send, Enter).
- Owner 2026-11-06 (shift 456): Apify is retired for good: no sourcing, no enrichment, no key or card in Settings. LinkedIn discovery is Claude web search over public pages only. Do not reintroduce a vendor scraper without the owner asking.
- Owner 2026-11-06 (shift 455): mbe-test merged into mbe-branch (design, Pipeline overview, Docker-safe same-origin check).
- Owner 2026-11-06: build and test an internal LinkedIn messaging bridge on mbe-branch, knowingly against LinkedIn's terms, on the owner's own account, owner accepts the ban risk. Kept consistent with 2026-11-03 "no bot-detection evasion": runs in the owner's real browser, no proxy, no headless browser, no fingerprint spoofing, no random "human" delays; fixed pacing only (40/24 h, 90 s gap, env-tunable). Every send is one human click; nothing automated can queue a LinkedIn message, EXCEPT the campaign autopilot of ADR 0002 (2026-11-09).
- The existing outreach pipeline stays assisted-manual for LinkedIn (`src/lib/linkedin-policy.ts`, `getOutboundChannelPolicy`, guardrail prompt unchanged). The bridge is a separate, flag-gated path.
- A LinkedIn inbox is personal: bridge rows are scoped to (workspace, user); no workspace-wide view. Disconnect deletes everything synced.
- Owner 2026-11-06 (shift 454): the bridge is candidate-centred. Only conversations with sourced candidates are shown and kept in full; no general inbox page. One LinkedIn account per ARIA user. Invitations are a click on the candidate (note optional), never automatic. Profile reads are on first look, on click, and daily for pending invitations only.
- Owner 2026-11-03: the Docker stack targets a Mac; do not spend effort on Windows-specific Docker issues.
- Owner 2026-11-03: Vercel is dropped; the app will be self-hosted later (target not chosen). Merging into vercel-demo is no longer a goal.
- Owner 2026-11-03: no local LLM / Ollama for now; AI stays on the Anthropic key.
- Owner 2026-11-03: Kong replaced by Caddy as the API gateway.
- Owner 2026-11-03: no stealth scraping or bot-detection evasion; LinkedIn discovery without Apify goes through Claude's web search on public indexed pages (`WebSearch` source).
- Owner 2026-11-03: no "hermes" in the code (product is Aria).
- All AI runs on Claude via one Anthropic key, within 20-30 EUR/month; GDPR validated by the owner (2026-10-30).
- Model per task: Haiku for classify/extract, Sonnet for chat, outreach and sourcing, Opus only by explicit choice.
- Browser missions (Run Aria, Triage inbox, follow-ups) still run client-side on store actions; the campaign autopilot runs server-side (ADR 0002).
- Sourcing spends only an admin vault key; the env/.secret key serves chat and local dev. Deterministic fallbacks everywhere; human approval before any send.
- UX: English UI ("Talent pool"), one /100 score, no personal credit (Mantu Group mention), Carlito self-hosted, nav per audit §4 with one "New campaign".
- Careers stays outside the workspace store provider (test-enforced); demo roles come from the API, not the browser store.
- Tutorial never opens on its own (owner, 2026-11-02). Contact basis can be recorded on synthetic demo profiles (owner, 2026-11-02).

## Watch out

- Do not edit the settings copy on #168, the channel catalog on #177, or the token panel on #178 from this branch. The tour sentence has to stay consistent with those strings when they merge.
- `tests/a11y-c2a-playwright.mts` is not in `npm test`. It needs `npm run dev` and Playwright Chromium. It does not click Send.
- The hero orb still spins for people who have not asked for reduced motion. The reduced-motion rule is what stops `.animate-spin-slow`.
- Base CI Secret scan, Local Docker demo, and Release gate are already red at `e3fa3f59`. Do not treat a repeat of those three as a regression from this diff.
- Carried from shift 468: do not pass a short `ARIA_RELEASE_SHA` to `docker compose build`. Do not run a test that calls `DELETE /api/linkedin/account` as the owner user. Several files use CRLF; use the editor rather than multiline perl.
