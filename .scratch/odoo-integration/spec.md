# ARIA <-> Odoo integration

Status: ready-for-human (built on branch `odoo`, owner review of ADR 0003 pending)
Started: 2026-11-23 (shift 469), at the owner's request: the group's IT is
adopting Odoo (open source); find where ARIA fits and model ARIA to work with it.

Decision and boundary: `docs/adr/0003-odoo-recruitment-system-of-record.md`.
How it works and how to connect it: `docs/odoo.md`.

## Built (shift 469)

- JSON-2 client, mapping, Odoo operations, server authority:
  `src/lib/integrations/odoo/`.
- Routes `src/app/api/integrations/odoo/{config,check,jobs,links,applicants}`.
- Migration `0010_odoo_integration.sql`: `odoo_connections`, `odoo_job_links`,
  `odoo_applicant_links`, `odoo_candidate_record()` (service role only).
- UI: Settings > Integrations > Odoo (connect, test, stage mapping), "Import
  from Odoo" on the new-campaign page, the Odoo strip on the campaign page
  (link, sync), "Send to Odoo" in the candidate drawer.
- Intake: the generic parser reads an explicit "Required skills:" line.
- Verified: `tests/odoo-integration.mts`, the `odoo-integration` DB scenario,
  `scripts/smoke-odoo.mts --write` on real Odoo 19.0 and 20.0, and a browser
  walk on a disposable ARIA stack against Odoo 20 (connect, import, parse,
  create, add candidate, send, Odoo moves the applicant, sync to Interviewed
  then Hired, the "open in Odoo" link lands on the applicant form).

## Follow-ups

| # | Issue | Status |
|---|---|---|
| 01 | Push from Odoo: an Odoo automated action (Community has "send webhook") calls a signed ARIA route on stage change, instead of reading on campaign open | needs-triage |
| 02 | Re-run the walk with a minimal-rights Odoo user (Recruitment officer only) and document the exact groups | ready-for-agent |
| 03 | Talent pools: refused-but-good applicants back to ARIA's #Vivier; current Odoo employees excluded from sourcing | needs-triage |
| 04 | Recruiter identity: map Odoo `recruiter_id` to the ARIA user; same sign-in as Odoo (Entra) | needs-info |
| 05 | The hand-off route does not check server-side that a confidential profile was revealed (the drawer hides the button while masked); decide if it must | needs-triage |
| 06 | Erasure: an ARIA candidate erasure does not reach the Odoo applicant; decide the process with the DPO | needs-info |
| 07 | Staffing needs from Odoo CRM opportunities (consulting demand), if the group uses CRM | needs-info |
| 08 | A small Odoo module: "Source with ARIA" on the job form, ARIA score on the applicant kanban | needs-triage |
