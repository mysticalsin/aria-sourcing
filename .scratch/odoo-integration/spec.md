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

## Built (shift 470, owner's request 2026-11-24)

- Live updates: Odoo automation rule -> `POST /api/webhooks/odoo/<token>`
  (token stored as SHA-256; the call is a ping, ARIA reads the applicant back);
  set up from Settings > Odoo, automatically when the Odoo user may, else
  manual steps. Stage changes are applied on the server only
  (`src/lib/integrations/odoo/sync.ts`, also used by `POST /sync` on campaign
  open), and the browser store pulls newer server versions every 15 s when
  idle (`pullRemoteWorkspace` in `src/lib/store.ts`).
- Confidentiality: the hand-off route refuses a confidential profile without
  a logged reveal in the last 24 h (`confidentialityBlock`, data from
  `odoo_candidate_record` in migration 0011); the drawer saves before sending.
- Erasure: `/api/admin/candidates/erasure` also erases the Odoo applicant
  (`src/lib/integrations/odoo/erasure.ts`): deleted unless hired, own contact
  deleted, Odoo privacy log when allowed; receipts and retry in
  `odoo_erasures` / Settings > Odoo.
- Minimal rights: checked on Odoo 20 with an internal user holding only
  "Recruitment / Officer": everything works except writing `privacy.log` and
  creating the automation rule (both degrade cleanly). `checkOdoo` no longer
  reads `ir.model` (forbidden for that user).
- Verified: tests (35 Odoo, erasure route), DB scenario with 0011, smoke on
  Odoo 20 as admin and as the Officer-only user, browser walk on the
  disposable stack (live update without reload in ~30 s at the old 30 s pull,
  server refusal of an unrevealed profile, erasure deleting the Odoo
  applicant).

## Follow-ups

| # | Issue | Status |
|---|---|---|
| 01 | Push from Odoo (webhook) | done (shift 470) |
| 02 | Minimal-rights Odoo user | done on Odoo 20 (shift 470); not re-run on 19 |
| 03 | Talent pools: refused-but-good applicants back to ARIA's #Vivier; current Odoo employees excluded from sourcing | needs-triage |
| 04 | Recruiter identity: map Odoo `recruiter_id` to the ARIA user; same sign-in as Odoo (Entra) | needs-info |
| 05 | Server-side check of the confidential reveal | done (shift 470) |
| 06 | Erasure reaching the Odoo applicant | done (shift 470); DPO to confirm the hired-applicant rule |
| 07 | Staffing needs from Odoo CRM opportunities (consulting demand), if the group uses CRM | needs-info |
| 08 | A small Odoo module: "Source with ARIA" on the job form, ARIA score on the applicant kanban | needs-triage |
