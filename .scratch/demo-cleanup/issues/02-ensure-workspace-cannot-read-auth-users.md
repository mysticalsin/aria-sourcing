# ensure_workspace() cannot read auth.users, so new users land in a generic workspace

Status: done

## Evidence
After the owner/ACL reconciliation, the `postgres` role sees zero rows in
`auth.users` (`select count(*) from auth.users` → 0 as postgres, 1 as
supabase_admin). `ensure_workspace()` (migration 0018, security definer) reads
the caller's email from `auth.users`, gets null, falls back to the domain
`workspace`, creates "Workspace Workspace" and inserts a profile with a null
email.

The Docker bootstrap now seeds the admin from GoTrue's JSON (commit "fix(docker):
make the local compose stack boot and seed correctly"), so the demo admin is
fine. Any second user (teammate) still hits this bug.

## Fix direction
Read the email from the JWT claims (`auth.jwt() ->> 'email'`) inside
`ensure_workspace()` in a new migration, or grant the function owner a narrow
read on `auth.users(id, email)`. Add a disposable-DB test.

## Resolution (2026-10-26)

Fixed in `8650e9a8`: `ensure_workspace()` reads the caller email from the JWT claims (`request.jwt.claims`), not `auth.users`. Covered by `tests/db/ensure-workspace-authority.sql`. Adding more users is a later step.
