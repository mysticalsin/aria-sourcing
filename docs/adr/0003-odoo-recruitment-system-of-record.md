# ADR 0003 - Odoo Recruitment is the system of record; ARIA is the sourcing layer in front of it

Date: 2026-11-23
Status: proposed (built on branch `odoo`, waiting for the owner's review)
Guide: `docs/odoo.md`

## Context

The group's IT is adopting Odoo (open-source edition). Odoo's Recruitment app
is an applicant tracking system: job positions (`hr.job`), applications
(`hr.applicant`) in a stage pipeline, interviews in the calendar, refusal
reasons, offers, then the employee record (`hr.employee`). It does not look
for people who have not applied: no search of public profiles, no fit score
against a brief, no personalised first message, no LinkedIn conversation.
That is exactly what ARIA does.

The owner asked where ARIA should sit relative to Odoo. Facts checked against
real Odoo 19.0 and 20.0 instances (`docker/odoo/`, `scripts/smoke-odoo.mts`):

- Odoo 19+ has one external API, JSON-2 (`POST /json/2/<model>/<method>`,
  API key as bearer token, database in `X-Odoo-Database`). XML-RPC and
  JSON-RPC are deprecated in 19 and scheduled for removal in 20.
- Odoo 20 accepts only API keys of scope `rpc` on JSON-2 (the default when a
  user creates a key in Odoo); Odoo 19 also accepts unscoped keys.
- Odoo 18 split applicants into `hr.candidate` + `hr.applicant`; 19 and 20 are
  back to a single `hr.applicant` with `partner_name`, `email_from`,
  `linkedin_profile`, `source_id`, `priority`, `application_status`
  (ongoing / hired / refused / archived) and a chatter.
- Field names move between versions (`hr.job.user_id` became `recruiter_id`).

## Options considered

1. **ARIA in front of Odoo (chosen).** Odoo keeps the job positions and every
   application; ARIA finds and engages people for an Odoo job, and hands a
   candidate to Odoo when a recruiter decides to pursue them. Odoo's outcome
   comes back to ARIA.
2. **Rebuild ARIA as an Odoo module.** One tool for recruiters, but a rewrite
   of a Next.js/Postgres product into Python/OWL, and the sourcing agent,
   LinkedIn bridge and approval gates would have to be re-proven. Rejected.
3. **Odoo as ARIA's database.** Every sourced profile written to Odoo as an
   applicant. Fills the HR system with people who never answered (hundreds
   per campaign), mixes prospects with applicants, and widens the personal
   data held in the HR system. Rejected.
4. **Full two-way sync of candidates.** Two masters for the same record and
   conflict rules for every field. Rejected for now: the hand-off is one-way,
   only the outcome comes back.

## Decision

1. **Boundary.**

   | Odoo owns | ARIA owns |
   |---|---|
   | Job positions (the approved need) | Campaigns built from a job, sourcing, scoring, evidence |
   | Applications after the hand-off: stages, interviews, offer, hire, refusal | Prospects before the hand-off: outreach, LinkedIn, replies |
   | Employees | The record of what was handed off (`odoo_applicant_links`) |

2. **Flows.**
   - Odoo -> ARIA: a recruiter imports an open job position as a campaign
     brief ("Import from Odoo" on the new-campaign page). The campaign stays
     linked to the job (`odoo_job_links`); an existing campaign can be linked
     from its page.
   - ARIA -> Odoo: **only on a recruiter's click** ("Send to Odoo" in the
     candidate drawer). ARIA creates the applicant on the linked job (source
     "ARIA", priority from the star rating or score, name, email, phone,
     LinkedIn URL) and posts ARIA's evidence as an internal note. No email
     leaves Odoo because of ARIA. Idempotent: a claim row is taken before
     Odoo is called, and Odoo is searched (email, LinkedIn URL) before
     creating, so retries and double clicks never create a second applicant.
   - Odoo -> ARIA: the campaign page reads the Odoo state of its handed-off
     candidates and moves them in ARIA: forward only, except Odoo's outcomes
     (hired, refused, reopened) which always apply. Refused "by applicant"
     becomes Not interested. An admin maps custom Odoo stages to ARIA stages.
3. **Connection.** One Odoo per workspace, configured by an admin in
   Settings > Odoo: address, database, API key of a technical Odoo user
   (Recruitment officer rights). The key is encrypted at rest
   (`DATA_ENCRYPTION_KEY`), never returned to the browser, and only ever sent
   to the address it was entered for. The connection is tested against Odoo
   before it is saved. ARIA calls Odoo; Odoo never calls ARIA.
4. **Version.** Odoo 19 or later (JSON-2). Older versions are refused with a
   clear message, Odoo 18's separate candidate model included.

## Consequences

- Recruiters keep one pipeline of record in Odoo; ARIA is where the search and
  the first conversations happen. Reports on hires use Odoo's data, which ARIA
  now reads back for its own funnel.
- Only people a recruiter chose to pursue enter the HR system. The note on the
  applicant records where the profile came from and the contact basis noted in
  ARIA, which the DPO will want for the GDPR record.
- The link tables hold Odoo ids: changing the Odoo address or database clears
  them (a different database means different ids).
- New migration `0010_odoo_integration.sql` (three service-role tables and one
  service-only function). No change to existing tables.

## Not done (follow-ups, `.scratch/odoo-integration/`)

- Odoo -> ARIA push (Odoo automated action calling a signed ARIA webhook)
  instead of reading on page load.
- Sign-in with the same identity provider as Odoo; recruiter mapping
  (Odoo `recruiter_id` -> ARIA user).
- Talent pools: refused-but-good applicants back into ARIA's #Vivier, and
  Odoo employees excluded from sourcing.
- Staffing needs from Odoo CRM opportunities (consulting), if the group uses
  CRM for client demand.
- A small Odoo module ("Source with ARIA" button on the job form, ARIA score
  on the applicant kanban) if recruiters want to start from Odoo.
