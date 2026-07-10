# ROCKS — approved 2026-07-09 (Same Page Meeting round 5, VERDICT: APPROVED)
Company rock = Rock 1 (Tony's paste→fitting-candidates acceptance). Build order: 2 → 1 → 3 → 4 → 5 → 6 → 7.

## Rock 2: Safe encrypted Tavily key surface + full web_search chokepoint  ✅ DONE (Level 10 SHIP, proof 10/10 by Visionary)
Owner: Integrator
Done means: a Tavily key added via Settings persists ENCRYPTED, and every web_search path (source route, sourcing-tools runner, tool-loop) uses that stored key when no env key is set.
Proof: `npx tsx tests/web-tavily-key.mts` → VERIFIED 10 passed, 0 failed (Visionary hands)
Status: DONE

## Rock 1: Prove paste→REAL, FITTING candidates live (COMPANY)  ✅ DONE (Level 10 SHIP — live smoke green, real people)
Owner: Integrator
Done means: `scripts/smoke-source-live.mts` extracts location from the pasted need, queries GitHub with type:user + location + title, returns real PEOPLE (not orgs) with real github.com/<login> URLs, plus ≥1 real Tavily web/LinkedIn lead.
Proof: `npx tsx scripts/smoke-source-live.mts` → expected exit 0, prints ≥3 real user candidates + ≥1 web lead, zero synthetic (LIVE: network+GITHUB_TOKEN+TAVILY)
Status: DONE

## Rock 3: Honesty — no fabricated 'connected' integration cards  ✅ DONE (Level 10 SHIP — integrations-honesty 6/6)
Owner: Integrator
Done means: integrations.ts real:false cards show status 'not_configured' + lastSync null; dispatch-outbound distinguishes 'unconfigured' from 'failed'.
Proof: `npx tsx tests/integrations-honesty.mts` → expected exit 0 (no card has real:false AND status:'connected')
Status: DONE

## Rock 4: LinkedIn compliant discovery real (guardrails intact)  ✅ DONE (Level 10 SHIP — web-leads 21/21, guardrails intact)
Owner: Integrator
Done means: with a Tavily key, web-leads yields real public LinkedIn leads via site-scoped search + sparse extraction only; wire-enforcement + guardrails unchanged.
Proof: `npx tsx tests/linkedin-policy.mts && npx tsx tests/web-leads.mts && npx tsx tests/outreach-guardrails.mts` → expected all exit 0
Status: DONE

## Rock 5: Mailbox OAuth setup (guide + testable redirect)  ✅ DONE (Level 10 SHIP — auth-google-redirect 12/12)
Owner: Integrator
Done means: production-readiness/GOOGLE_OAUTH_SETUP.md exists; /auth/google returns a real accounts.google.com redirect under a set GOOGLE_CLIENT_ID (mocked admin+non-demo).
Proof: `npx tsx tests/auth-google-redirect.mts` → expected exit 0 (redirect Location host == accounts.google.com)
Status: DONE

## Rock 6: LinkedIn RSC partnership draft (Visionary-owned, rule 4)  ✅ DONE (7/7 sections)
Owner: Visionary
Done means: docs/partnerships/linkedin-rsc-application.md with all 7 sections from research-linkedin-rsc.md (honest: RSC ≠ sourcing API).
Proof: `grep -c` all 7 section headers present → expected 7
Status: DONE

## Rock 7: Green gate + reconcile  ✅ DONE (full gate: tsc PASS, 89 suites 0 failed, lint 0 errors)
Owner: Integrator
Done means: full offline gate green after all rocks; dirty worktree reconciled.
Proof: `npx tsc --noEmit && npm test` → expected exit 0 (82 files, 0 failed); `npm run lint` → 0 errors
Status: DONE
