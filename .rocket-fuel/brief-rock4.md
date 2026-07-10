You are the Integrator building Rock 4 in the MSourcing/ARIA Next.js repo. workspace-write. Build EXACTLY this.

Objective: prove LinkedIn compliant discovery is real — with a Tavily key, web-leads yields real public LinkedIn profile leads via site-scoped search + sparse extraction only, with the manual-only wire-enforcement and outreach guardrails fully intact.

Read first: (understand before editing)
- src/lib/sourcing/web-leads.ts — buildWebQuery (site:linkedin.com/in scoping ~37-56), extractLead (sparse SERP-title/slug extraction ~88-107). This is the LinkedIn DISCOVERY path.
- src/lib/linkedin-policy.ts:72-80 — getOutboundChannelPolicy returns manual-only for channel 'LinkedIn'; the regex guardrail (~15-65) blocking scraping/automation instructions. tests/linkedin-policy.mts (18 cases).
- src/app/api/source/route.ts:118-129 — the web branch that dispatches web_search for LinkedIn/StackOverflow/etc and maps leads.
- src/lib/mock-ai.ts mapWebSearchCandidates — maps web leads to scored candidates with email/location honestly blank, provenance 'live'.
- tests/outreach-guardrails.mts — the guardrail suite that must stay green.

Build:
1. Verify (and only fix if broken) that the LinkedIn discovery path does site-scoped SEARCH + sparse extraction ONLY — no scraping, no page-fetch of linkedin.com profiles, no automation. If any code fetches/parses a linkedin.com profile page directly, that is out of policy — do not add it; if present, note it. Do NOT weaken linkedin-policy.
2. Create tests/web-leads.mts (a `.mts` test in the repo style): assert buildWebQuery produces a site:linkedin.com/in scoped query for the LinkedIn platform; assert extractLead returns a lead with title/handle populated and email/location blank (never fabricated) from a sample SERP hit; assert mapWebSearchCandidates marks provenance 'live' and does NOT invent contact fields; assert the LinkedIn discovery path never emits a scraping/automation instruction (reuse linkedin-policy's guardrail).

Constraints: (what must NOT change) do not weaken or delete tests/linkedin-policy.mts or tests/outreach-guardrails.mts. Do not add any linkedin.com profile-page fetch/scrape. Do not change the manual-only wire policy. Keep SSRF/robots guards. No new dependencies.

Proof: the Visionary runs outside the sandbox: `npx tsx tests/linkedin-policy.mts` (18+ pass), `npx tsx tests/web-leads.mts` (new, pass), `npx tsx tests/outreach-guardrails.mts` (42 pass). You only need `npx tsc --noEmit` clean.

Stop when: tests/web-leads.mts exists and encodes the assertions above, linkedin-policy + outreach-guardrails are unchanged and still pass, no linkedin.com scraping was added, and `npx tsc --noEmit` is clean. Do not delete, skip, weaken, or narrow tests to make the goal pass.

Report: give the tsc result. SHIP = built + tsc clean + tests/web-leads.mts present + policy suites intact; REVISE = blocked/incomplete (state why).
End with EXACTLY one line, nothing after it: VERDICT: SHIP or VERDICT: REVISE
