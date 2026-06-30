-- =============================================================================
-- Public-demo admin seed — CLOUD Supabase
-- =============================================================================
-- Promotes the demo login account admin@hermes.local to an admin profile in the
-- app schema, and creates the shared "hermes.local" demo workspace.
--
-- PREREQUISITE: the auth user admin@hermes.local must already exist. Create it
-- either via the dashboard (Authentication → Users → Add user → tick "Auto
-- Confirm User") or via the GoTrue admin API (scripts/seed-cloud-admin.sh).
--
-- Run this AFTER the migrations (0001..0006) have been applied
-- (`supabase db push`, or pasted into the SQL Editor in order).
--
-- Idempotent — safe to re-run.
-- =============================================================================

insert into public.workspaces (name, allowed_domain)
  values ('Hermes Workspace', 'hermes.local')
  on conflict (allowed_domain) do nothing;

insert into public.profiles (id, email, full_name, workspace_id, role)
  select u.id, u.email, 'Admin', w.id, 'admin'
  from auth.users u
  join public.workspaces w on w.allowed_domain = 'hermes.local'
  where u.email = 'admin@hermes.local'
  on conflict (id) do update
    set role = 'admin',
        workspace_id = excluded.workspace_id,
        email = excluded.email;

-- Tell PostgREST to reload so /rest/v1 sees the seeded rows immediately.
notify pgrst, 'reload schema';
