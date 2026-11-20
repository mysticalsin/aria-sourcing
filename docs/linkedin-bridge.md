# LinkedIn bridge — removed

The Chrome extension, Voyager client, pairing token and inbox bridge were removed on `twa-odoo`. LinkedIn's User Agreement forbids that path. Do not recreate the extension directory, the server bridge library, the bridge API routes, or the bridge environment variables.

Aria does not call that network. A recruiter sends InMail in LinkedIn Recruiter. Profile URLs that a person already has (a Recruiter CSV export, an ATS record, or the candidate) may be stored and shown. They are not fetched.

Migrations `0006`–`0008` stay as history. `supabase/migrations/0010_drop_linkedin_bridge.sql` drops the bridge tables, including `token_hash`. That migration is destructive and unapplied. Existing databases keep `token_hash` until it runs.

`supabase/migrations/0011_drop_agent_autopilot.sql` drops the autopilot tables from `0009`. It is also unapplied until a database runs it.
