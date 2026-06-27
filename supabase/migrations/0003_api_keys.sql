-- ============================================================================
-- Hermes Sourcing — API keys / secrets (server-side, role-gated)
-- Secrets are stored here, NEVER returned to the browser: a column-level grant
-- withholds `secret` from the `authenticated` role, so even a permitted SELECT
-- returns only metadata. Server-side validation reads the secret via the
-- service-role client. Run AFTER 0001_init.sql.
-- ============================================================================

create table if not exists public.api_keys (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  name           text not null,
  provider       text not null,
  secret         text not null,
  last4          text not null,
  status         text not null default 'untested',
  last_tested_at timestamptz,
  created_by     text,
  created_at     timestamptz not null default now()
);

alter table public.api_keys enable row level security;

-- Column-level privileges: members may read metadata, never the secret.
revoke all on public.api_keys from authenticated;
grant select (id, workspace_id, name, provider, last4, status, last_tested_at, created_by, created_at)
  on public.api_keys to authenticated;
grant insert, update, delete on public.api_keys to authenticated;

-- RLS: members of the workspace read; only ADMINS write.
drop policy if exists "members read keys"  on public.api_keys;
drop policy if exists "admins insert keys" on public.api_keys;
drop policy if exists "admins update keys" on public.api_keys;
drop policy if exists "admins delete keys" on public.api_keys;
create policy "members read keys" on public.api_keys for select
  using (workspace_id = public.current_workspace_id());
create policy "admins insert keys" on public.api_keys for insert
  with check (workspace_id = public.current_workspace_id() and public.current_profile_role() = 'admin');
create policy "admins update keys" on public.api_keys for update
  using (workspace_id = public.current_workspace_id() and public.current_profile_role() = 'admin');
create policy "admins delete keys" on public.api_keys for delete
  using (workspace_id = public.current_workspace_id() and public.current_profile_role() = 'admin');
