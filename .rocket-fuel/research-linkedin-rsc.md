# LinkedIn RSC research — meeting input for round 2 (verified 2026-07-09, learn.microsoft.com li-lts-2026-03)

## The load-bearing correction
RSC (Recruiter System Connect) is **NOT a candidate-sourcing/search API**. It synchronizes candidate data between an ATS and LinkedIn **Recruiter** (a paid human-seat product). Features: Rediscovered Candidates, In-ATS Indicator, One-Click Export, Enhanced Profile Widget, Retrieve InMail History, Stub Profiles after InMail. RSC+ adds requisition-stage sync, application evaluations, attachment sync, Connected Projects.

Implication for MSourcing: even with RSC, you cannot call an API to "find LinkedIn candidates matching a JD." Sourcing LinkedIn members happens *inside* LinkedIn Recruiter (human) or via licensed public web-search (what MSourcing does today). "LinkedIn with the API" for automated sourcing does not exist as a product.

## What RSC would give MSourcing (only if it becomes an ATS-sync partner)
Two-way sync so a customer's LinkedIn Recruiter shows "already in ATS" + export candidates from Recruiter into MSourcing. Relevant only if the strategy is "MSourcing is the ATS of record and integrates with customers' existing Recruiter seats."

## Requirements to pursue RSC (ordered, factual)
1. Be a LinkedIn Talent Solutions Partner — submit the Partner Request Form (business.linkedin.com/talent-solutions/ats-partners/partner-application). Approval + signed API agreement with data restrictions is mandatory; APIs restricted to LinkedIn-approved developers.
2. Develop a **Job Posting** integration first (prerequisite before RSC dev).
3. Create 2 API apps (prod + dev/test) at linkedin.com/developer/apps.
4. LinkedIn Business Development contact → Partner Onboarding Form → test credentials mailed.
5. Build on the **Middleware Platform**; auth is **OAuth 2-legged (client-credentials)** per customer (Client ID/Secret + Organization URN + Contract URN persisted per customer).
6. Implement 5 Development Modules: (1) customer app/ATS config, (2) sync ATS→LinkedIn, (3) retrieve data from LinkedIn via push notifications to a callback URL, (4) sync ACLs, (5) data deletion.
7. Pass 6 Certification Modules (demo test cases to LinkedIn) + meet data-quality thresholds before GA.

Lead time: weeks-to-months, business-development gated. This is a partnership track, not code MSourcing can ship unilaterally.

## Honest compliant posture until/unless RSC lands (already true in code)
- Sourcing: licensed public web-search of public LinkedIn profiles (Tavily-backed), sparse fields, no scraping (SSRF+robots guard).
- Outreach: assisted-manual only — /api/outreach/send 409 manual-required (linkedin-policy.ts, 18 tests). No automation.

## Recommendation to Owner
"Both in parallel" (Tony's choice) reframed honestly: (A) ship the compliant web-discovery + manual path NOW (real, buildable); (B) the "partnership" track is a BUSINESS-DEVELOPMENT pursuit to become a Talent Solutions/ATS partner — and even it does not yield automated sourcing, only ATS↔Recruiter sync. If the goal is "more/better LinkedIn candidates by API," neither RSC nor any public API delivers that; the realistic lever is a LinkedIn Recruiter seat (human) + web-discovery. Surface this to Tony before he invests in the partnership expecting a sourcing API.

Sources: https://learn.microsoft.com/en-us/linkedin/talent/recruiter-system-connect/recruiter-system-connect?view=li-lts-2026-03 · https://business.linkedin.com/talent-solutions/ats-partners/partner-application
