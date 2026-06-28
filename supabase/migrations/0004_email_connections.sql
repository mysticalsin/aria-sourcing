-- ============================================================================
-- Hermes Sourcing — OAuth email connections for Gmail / Microsoft Graph seats.
-- One connection per seat. Tokens are secrets; column-level grants withhold
-- them from the authenticated role. Run AFTER 0002_fleet.sql and 0003_api_keys.sql.
-- ============================================================================

create table if not exists public.email_connections (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  seat_id        uuid not null references public.agent_seats(id) on delete cascade,
  provider       text not null check (provider in ('Gmail API','Microsoft Graph')),
  account_email  text not null,
  access_token   text not null,
  refresh_token  text,
  expires_at     timestamptz,
  scope          text not null default '',
  connected_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id, seat_id)
);

alter table public.email_connections enable row level security;

-- Column-level privileges: members may read metadata, never the tokens.
revoke all on public.email_connections from authenticated;
grant select (id, workspace_id, seat_id, provider, account_email, scope, connected_at, updated_at)
  on public.email_connections to authenticated;
grant insert, update, delete on public.email_connections to authenticated;

-- RLS: members of the workspace read; only ADMINS write.
drop policy if exists "members read email_connections"  on public.email_connections;
drop policy if exists "admins insert email_connections" on public.email_connections;
drop policy if exists "admins update email_connections" on public.email_connections;
drop policy if exists "admins delete email_connections" on public.email_connections;
create policy "members read email_connections" on public.email_connections for select
  using (workspace_id = public.current_workspace_id());
create policy "admins insert email_connections" on public.email_connections for insert
  with check (workspace_id = public.current_workspace_id() and public.current_profile_role() = 'admin');
create policy "admins update email_connections" on public.email_connections for update
  using (workspace_id = public.current_workspace_id() and public.current_profile_role() = 'admin');
create policy "admins delete email_connections" on public.email_connections for delete
  using (workspace_id = public.current_workspace_id() and public.current_profile_role() = 'admin');

-- Index for looking up a seat's connection.
create index if not exists email_connections_seat_idx on public.email_connections (workspace_id, seat_id);
