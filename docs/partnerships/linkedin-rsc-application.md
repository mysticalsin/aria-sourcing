# LinkedIn Recruiter System Connect (RSC) — partnership track

> Status: research + application plan. Not code MSourcing can ship unilaterally.
> Sources (verified 2026-07-09): learn.microsoft.com/linkedin/talent/recruiter-system-connect (li-lts-2026-03); business.linkedin.com/talent-solutions/ats-partners/partner-application.

## 1. What RSC is — and is NOT
RSC synchronizes candidate data **between an ATS and LinkedIn Recruiter** (a paid human-seat product). RSC 1.0 features: Rediscovered Candidates, In-ATS Indicator, One-Click Export, Enhanced Profile Widget, Retrieve InMail History, Stub Profiles after an InMail response. RSC+ adds: requisition-stage sync, application evaluations, attachment sync, Connected Projects.

**RSC is NOT a candidate-search / sourcing API.** There is no LinkedIn API — RSC or otherwise — that takes a job description and returns matching LinkedIn members. Sourcing LinkedIn members happens *inside* LinkedIn Recruiter (human) or via licensed public web-search. Pursue RSC only if the strategy is "MSourcing is an ATS of record that integrates with customers' existing Recruiter seats," not "get more candidates by API."

## 2. Eligibility
- Must be (or become) a **LinkedIn Talent Solutions Partner** — submit the Partner Request Form.
- A signed **API agreement with data restrictions** is mandatory; RSC endpoints are restricted to LinkedIn-approved developers.
- Access is gated by a LinkedIn Business Development / Relationship Manager contact.

## 3. Prerequisite — Job Posting integration first
Before developing with RSC you must first build a **Job Posting** integration. RSC development does not begin until that is in place.

## 4. Development modules (5) + certification modules (6)
Dev modules: (1) configure customer applications & ATS integrations, (2) sync data ATS→LinkedIn (candidates/applications/notes via Middleware Platform), (3) retrieve data from LinkedIn (push notifications to your callback URL), (4) sync ACLs, (5) data deletion. Built on the **Middleware Platform** — manage applications exclusively via Middleware endpoints. Certification: 6 modules of test cases demoed to LinkedIn; must also meet the RSC **data-quality thresholds** before GA.

## 5. Auth model
**OAuth 2-legged (client-credentials)**, invoked **per customer**: the partner persists a Client ID/Secret + Organization URN + Contract URN for each customer and calls RSC on that customer's behalf. Paged results (rest.li pagination).

## 6. Interim compliant posture (already true in MSourcing code)
Until/unless RSC lands, MSourcing stays compliant and shippable:
- **Sourcing**: licensed public web-search of public LinkedIn profiles (Tavily-backed site-scoped search), sparse fields, SSRF + robots guarded, no scraping (src/lib/sourcing/web-leads.ts; src/lib/ai/web-tools.ts).
- **Outreach**: assisted-manual only — /api/outreach/send returns 409 manual-required for LinkedIn (src/lib/linkedin-policy.ts; 18 passing enforcement tests).
- No LinkedIn-origin data feeds automated scoring/LLM prompting without a contractual basis.

## 7. Honest recommendation to the Owner
"Both in parallel" reframed truthfully:
- **Track A (build now, real):** compliant web-discovery + manual outreach + a LinkedIn Recruiter seat for the human sourcing that no API provides. This is the realistic lever for LinkedIn candidates.
- **Track B (business development, months):** pursue Talent Solutions / ATS partnership → Job Posting → RSC. Its payoff is ATS↔Recruiter **sync**, not sourcing-by-API. Only worth the investment if MSourcing positions as an ATS of record.

Do not fund Track B expecting a sourcing API — it does not exist. The application first-step is the Partner Request Form; owner decision required before committing BD time.
