# ARIA and Odoo

How ARIA works with the group's Odoo, and how to connect it. The decision and
the options that were rejected are in
[`adr/0003-odoo-recruitment-system-of-record.md`](adr/0003-odoo-recruitment-system-of-record.md).

## Where ARIA sits

Odoo Recruitment is the system of record for hiring: job positions,
applications, interviews, offers, hires, then employees. ARIA works in front
of it, on the part Odoo does not do: finding people who have not applied,
scoring them against the brief, and the first conversations (email, LinkedIn).

```text
            Odoo Recruitment                              ARIA
  ┌──────────────────────────────┐          ┌──────────────────────────────┐
  │ Job position (hr.job)        │──(1)────>│ Campaign (brief, sourcing)   │
  │                              │          │ Prospects: score, evidence,  │
  │                              │          │ outreach, replies            │
  │ Applicant (hr.applicant)     │<──(2)────│ "Send to Odoo" (recruiter)   │
  │ stages, interviews, offer,   │          │                              │
  │ hired / refused              │──(3)────>│ Candidate stage follows      │
  │ Employee (hr.employee)       │          │                              │
  └──────────────────────────────┘          └──────────────────────────────┘
  (1) import an open job as a campaign brief; the campaign stays linked to it
  (2) hand-off: one applicant + one internal note, on a recruiter's click
  (3) Odoo's stage and outcome come back to ARIA
```

ARIA calls Odoo; Odoo never calls ARIA. Only people a recruiter decides to
pursue enter Odoo. Everyone else ARIA found stays in ARIA.

## Requirements

- Odoo **19 or later**, Community (open source) or Enterprise, self-hosted.
  ARIA uses Odoo's JSON-2 API (`/json/2/<model>/<method>`); XML-RPC and
  JSON-RPC are deprecated in 19 and scheduled for removal in 20. ARIA refuses
  older versions with a clear message. Checked on Odoo 19.0 and 20.0.
- The **Recruitment** app installed. The **Skills** app is optional: when a
  job position lists skills, ARIA puts them in the brief.
- The ARIA server can reach Odoo over **HTTPS** (internal address is fine).
  Plain HTTP is refused unless the ARIA server sets `ODOO_ALLOW_HTTP=true`
  (local development only).
- `DATA_ENCRYPTION_KEY` set on the ARIA server (the Odoo API key is stored
  encrypted, like the other provider keys; without it the connection is
  refused in a live workspace).

## Connect Odoo (IT and an ARIA admin)

In Odoo:

1. Create an internal user for ARIA, for example "ARIA integration", with
   Recruitment access "Officer" (or "Administrator"). Everything ARIA does in
   Odoo is done as this user, and the chatter shows it as the author. The end
   to end checks were run with the Odoo administrator; a minimal-rights user
   is the recommended set-up but has not been re-checked yet.
2. Log in as that user, open *My Profile > Account Security > New API Key*.
   Keep the scope **RPC** (the default: Odoo 20 accepts only RPC-scoped keys
   on JSON-2), choose the longest duration your Odoo allows, and copy the key.
   When the key expires, ARIA's Odoo actions fail with "Odoo refused the API
   key" until an admin enters a new one.

In ARIA, as an admin, *Settings > Integrations > Odoo*:

3. Odoo address (as the ARIA server reaches it), database name, API key. An
   optional second address is used for the "open in Odoo" links when people
   reach Odoo at another address than the server does.
4. *Connect Odoo* tests the connection first (version, key, database,
   Recruitment app) and saves only if it works. The key is never shown again;
   it is only ever sent to the address it was entered for (changing the
   address or database asks for the key again, and clears the campaign and
   candidate links, whose Odoo ids belong to the old database).
5. Check the **Odoo stage → ARIA stage** table. Defaults: the first stage
   changes nothing; names with qualification, screening or prequal mean
   Interested; interview / entretien / Intw mean Interviewed; contract, offer
   or proposal mean Offer; the hired stage means Hired. Override any stage.

## Use it (recruiters)

- **Start from an Odoo job.** *New campaign > Import from Odoo*, pick an open
  job position. Its title, department, location, contract type, openings,
  salary, skills and description become the brief; parse it and review it as
  usual. The campaign is created linked to that job. An existing campaign is
  linked from the Odoo strip on its page (*Link to an Odoo job*).
- **Send a candidate to Odoo.** In the candidate drawer, *Send to Odoo* (after
  revealing the profile if confidentiality mode hides it). ARIA creates the
  applicant on the linked job. Sending twice, from two tabs, or after an
  error never creates a second applicant; if Odoo already has an application
  for the same email or LinkedIn URL on that job, ARIA links it instead. If
  the applicant is later deleted in Odoo, the candidate can be sent again.
- **Follow it.** Opening the campaign reads the Odoo state of its handed-off
  candidates (*Sync from Odoo* does it again). ARIA moves a candidate forward
  only, except Odoo's outcomes, which always apply: hired → Hired, refused →
  Rejected (with Odoo's reason), refused by the applicant → Not interested,
  reopened → the stage it maps to. A suppressed candidate is never moved. Each
  move is written in the candidate's notes. After the hand-off, change the
  hiring steps in Odoo, not in ARIA.

## What ARIA writes and reads in Odoo

| ARIA does | Odoo model | Fields |
|---|---|---|
| Reads open job positions | `hr.job` | name, description, requirements, department, address, openings, recruiter (and the recruiter's work email), salary range and currency, pay interval, employee type, skills, application count |
| Creates the "ARIA" source once | `utm.source` | name |
| Creates the applicant | `hr.applicant` | name, email, phone, LinkedIn URL, job, source "ARIA", priority (stars from the Mantu rating, else from the score: 85+ = 3, 70+ = 2, 50+ = 1) |
| Posts one internal note (no email) | chatter (`message_post`, subtype note) | who sent it and when, campaign, ARIA score and breakdown, skills seen, where the profile was found (links), ARIA stage at hand-off, contact basis recorded in ARIA |
| Reads the applicant's state | `hr.applicant`, `hr.recruitment.stage` | stage, application status, refuse reason |

Field names move between Odoo versions (`hr.job.user_id` became
`recruiter_id`), so ARIA asks Odoo which fields exist (`fields_get`) and only
reads or writes those. ARIA never writes to an applicant after the hand-off,
and never deletes anything in Odoo.

## Security and personal data

- The API key is encrypted at rest, never returned to the browser, and sent
  only to the configured Odoo. Redirects are refused, so the key cannot follow
  one to another host. Responses are size- and time-limited.
- Odoo's error answers contain a full server traceback; ARIA keeps only the
  error class and Odoo's one-line message.
- Everything a candidate's profile contains is escaped before it goes into the
  Odoo note (profiles come from public web pages), and only http(s) links are
  kept.
- Only an admin connects Odoo. Members with the *source* permission import
  jobs, link campaigns and send candidates; anyone in the workspace sees the
  Odoo stage. Every action in Odoo runs as the integration user, so an ARIA
  member who has no Odoo account can still create applicants on linked jobs.
- The Odoo address is admin-entered and may be internal (private addresses
  are allowed, unlike ARIA's public web fetches).
- Synthetic demo profiles, anonymized, suppressed, unsubscribed and
  do-not-contact candidates are never sent.
- Handing a candidate to Odoo copies their data into the HR system: the note
  records the source and the contact basis noted in ARIA for the DPO.
  Retention and erasure in Odoo follow Odoo's own process; an erasure in ARIA
  does not delete the Odoo applicant.

## Not done yet

See `.scratch/odoo-integration/spec.md`: push from Odoo instead of reading on
page load, same sign-in as Odoo, talent pools both ways, excluding current
employees from sourcing, staffing needs from Odoo CRM, a small Odoo module.

## Local development

```bash
bash docker/odoo/setup.sh   # Odoo 20 on http://localhost:8069 (admin / admin),
                            # database "aria" with Recruitment, Skills and demo
                            # data, API key in docker/odoo/.odoo-api-key
```

Run the ARIA server with `ODOO_ALLOW_HTTP=true`, then connect *Settings > Odoo*
to `http://host.docker.internal:8069` (app in Docker) or
`http://localhost:8069` (`next dev`), database `aria`.

Check a real Odoo, read-only or with a write round trip on a test database:

```bash
ODOO_URL=http://localhost:8069 ODOO_DB=aria ODOO_ALLOW_HTTP=true \
ODOO_API_KEY_FILE=docker/odoo/.odoo-api-key npx tsx scripts/smoke-odoo.mts [--write]
```

Code: `src/lib/integrations/odoo/` (client, mapping, Odoo operations, server
authority), routes under `src/app/api/integrations/odoo/`, UI in
`src/components/odoo/` and `src/components/settings/odoo-panel.tsx`, tables in
`supabase/migrations/0010_odoo_integration.sql`. Tests:
`tests/odoo-integration.mts` (in `npm test`) and the `odoo-integration`
scenario of `npm run test:db-schema-authority`.
