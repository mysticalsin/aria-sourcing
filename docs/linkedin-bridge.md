# LinkedIn bridge — removed

The Chrome extension, Voyager client, pairing token and inbox bridge were removed on `twa-odoo`. LinkedIn's User Agreement forbids that path. Do not recreate `extensions/linkedin-bridge`, `src/lib/linkedin-bridge`, `src/app/api/linkedin`, or the `LINKEDIN_BRIDGE_*` environment variables.

Aria does not call linkedin.com. A recruiter sends InMail in LinkedIn Recruiter. Profile URLs that a person already has (a Recruiter CSV export, an ATS record, or the candidate) may be stored and shown. They are not fetched.

Migrations `0006`–`0008` stay as history. A later migration drops the bridge tables.
