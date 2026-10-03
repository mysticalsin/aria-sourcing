-- ============================================================================
-- LinkedIn OpenID Connect connections (Sign In with LinkedIn).
-- Stores encrypted access/refresh tokens + public profile metadata.
-- Messaging still uses assisted-manual / vendor seats — OIDC proves identity only.
-- ============================================================================

create table if not exists public.linkedin_oauth_connections (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  seat_id         uuid not null references public.agent_seats(id) on delete cascade,
  linkedin_sub    text not null,
  display_name    text not null default '',
  email           text,
  picture_url     text,
  access_token    text not null,
  refresh_token   text,
  expires_at      timestamptz,
  scope           text not null default 'openid profile email',
  connected_at    timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, seat_id),
  unique (workspace_id, linkedin_sub)
);

alter table public.linkedin_oauth_connections enable row level security;

revoke all on public.linkedin_oauth_connections from anon, public, authenticated;
grant select (
  id, workspace_id, seat_id, linkedin_sub, display_name, email, picture_url,
  scope, connected_at, updated_at
) on public.linkedin_oauth_connections to authenticated;
grant insert, update, delete on public.linkedin_oauth_connections to authenticated;

drop policy if exists "members read linkedin_oauth_connections" on public.linkedin_oauth_connections;
create policy "members read linkedin_oauth_connections"
  on public.linkedin_oauth_connections for select
  using (workspace_id = public.current_workspace_id());

drop policy if exists "admins insert linkedin_oauth_connections" on public.linkedin_oauth_connections;
create policy "admins insert linkedin_oauth_connections"
  on public.linkedin_oauth_connections for insert
  with check (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  );

drop policy if exists "admins update linkedin_oauth_connections" on public.linkedin_oauth_connections;
create policy "admins update linkedin_oauth_connections"
  on public.linkedin_oauth_connections for update
  using (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  );

drop policy if exists "admins delete linkedin_oauth_connections" on public.linkedin_oauth_connections;
create policy "admins delete linkedin_oauth_connections"
  on public.linkedin_oauth_connections for delete
  using (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  );

create index if not exists linkedin_oauth_connections_seat_idx
  on public.linkedin_oauth_connections (workspace_id, seat_id);

-- Composite FK for (workspace_id, seat_id) integrity (mirrors email_connections).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'linkedin_oauth_connections_workspace_seat_fkey'
      and conrelid = 'public.linkedin_oauth_connections'::regclass
  ) then
    alter table public.linkedin_oauth_connections
      add constraint linkedin_oauth_connections_workspace_seat_fkey
      foreign key (workspace_id, seat_id)
      references public.agent_seats (workspace_id, id)
      on delete cascade;
  end if;
end $$;
