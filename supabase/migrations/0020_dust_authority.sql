-- ============================================================================
-- ARIA normalized Dust execution authority
--
-- workspace_state is an operator-editable collaboration document. It must not
-- choose an external tenant, agent, or bearer credential. This table is the one
-- admin-owned authority used by server-side Dust execution.
-- ============================================================================

create table if not exists public.dust_connections (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null unique references public.workspaces(id) on delete cascade,
  dust_workspace_id   text not null,
  region              text not null default 'us',
  api_key_id           uuid not null,
  credential_provider text not null default 'Dust',
  agent_locks         jsonb not null default '{}'::jsonb,
  agents              jsonb not null default '[]'::jsonb,
  enabled             boolean not null default true,
  config_revision     bigint not null default 1,
  created_by          uuid references auth.users(id) on delete set null,
  updated_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint dust_connections_workspace_id_check
    check (length(btrim(dust_workspace_id)) between 1 and 256),
  constraint dust_connections_region_check
    check (region in ('us', 'eu')),
  constraint dust_connections_provider_check
    check (credential_provider = 'Dust'),
  constraint dust_connections_agent_locks_check
    check (jsonb_typeof(agent_locks) = 'object'),
  constraint dust_connections_agents_check
    check (jsonb_typeof(agents) = 'array'),
  constraint dust_connections_revision_check
    check (config_revision > 0),
  constraint dust_connections_key_binding_fkey
    foreign key (api_key_id, workspace_id, credential_provider)
    references public.api_keys(id, workspace_id, provider)
    on delete restrict
);

-- Append-only non-secret evidence. The digest proves which canonical Dust
-- authority was active without copying workspace ids, agent metadata, key ids,
-- or any credential material into the audit surface.
create table if not exists public.dust_connection_events (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  connection_id   uuid not null,
  actor_id         uuid references auth.users(id) on delete set null,
  action           text not null check (action in ('insert', 'update', 'delete')),
  config_revision  bigint not null,
  config_hash      text not null check (config_hash ~ '^[0-9a-f]{64}$'),
  created_at       timestamptz not null default now()
);

create index if not exists dust_connection_events_authority_idx
  on public.dust_connection_events (workspace_id, connection_id, created_at desc);

alter table public.dust_connections enable row level security;
alter table public.dust_connections force row level security;
alter table public.dust_connection_events enable row level security;
alter table public.dust_connection_events force row level security;

revoke all on public.dust_connections
  from public, anon, authenticated, service_role, authenticator;
revoke all on public.dust_connection_events
  from public, anon, authenticated, service_role, authenticator;
grant select, insert, update, delete on public.dust_connections to authenticated;
grant select on public.dust_connection_events to authenticated;
grant select on public.dust_connections to service_role;

-- Non-secret configuration is visible to workspace members so operators can
-- see which locked agent will run. Only admins can change execution authority.
drop policy if exists "members read Dust connections" on public.dust_connections;
create policy "members read Dust connections"
  on public.dust_connections for select
  using (workspace_id = public.current_workspace_id());

drop policy if exists "admins insert Dust connections" on public.dust_connections;
create policy "admins insert Dust connections"
  on public.dust_connections for insert
  with check (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  );

drop policy if exists "admins update Dust connections" on public.dust_connections;
create policy "admins update Dust connections"
  on public.dust_connections for update
  using (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  )
  with check (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  );

drop policy if exists "admins delete Dust connections" on public.dust_connections;
create policy "admins delete Dust connections"
  on public.dust_connections for delete
  using (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  );

drop policy if exists "admins read Dust connection events"
  on public.dust_connection_events;
create policy "admins read Dust connection events"
  on public.dust_connection_events for select
  using (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  );

-- FORCE RLS also applies to the restricted postgres migration role that owns
-- the SECURITY DEFINER trigger. This narrow policy is its only event write.
drop policy if exists "Dust audit trigger inserts events"
  on public.dust_connection_events;
create policy "Dust audit trigger inserts events"
  on public.dust_connection_events for insert to postgres
  with check (true);

create or replace function public.stamp_dust_connection_authority()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.config_revision := 1;
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
  else
    new.id := old.id;
    new.workspace_id := old.workspace_id;
    new.credential_provider := old.credential_provider;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := auth.uid();
    new.updated_at := now();
    new.config_revision := old.config_revision + 1;
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_dust_connection_authority()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists dust_connections_stamp_authority on public.dust_connections;
create trigger dust_connections_stamp_authority
  before insert or update on public.dust_connections
  for each row execute function public.stamp_dust_connection_authority();

create or replace function public.audit_dust_connection_authority()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  authority public.dust_connections%rowtype;
  authority_hash text;
begin
  if tg_op = 'DELETE' then
    authority := old;
  else
    authority := new;
  end if;

  authority_hash := encode(
    digest(
      jsonb_build_array(
        authority.workspace_id::text,
        authority.dust_workspace_id,
        authority.region,
        authority.api_key_id::text,
        authority.credential_provider,
        authority.agent_locks,
        authority.agents,
        authority.enabled,
        authority.config_revision::text
      )::text,
      'sha256'
    ),
    'hex'
  );

  insert into public.dust_connection_events (
    workspace_id,
    connection_id,
    actor_id,
    action,
    config_revision,
    config_hash
  ) values (
    authority.workspace_id,
    authority.id,
    auth.uid(),
    lower(tg_op),
    authority.config_revision,
    authority_hash
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.audit_dust_connection_authority()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists dust_connections_audit_authority
  on public.dust_connections;
create trigger dust_connections_audit_authority
  after insert or update or delete on public.dust_connections
  for each row execute function public.audit_dust_connection_authority();

-- Existing Dust JSON cannot be trusted for backfill because members were
-- allowed to write it. Remove it on migration and on every future state write;
-- an admin reconnects once through the normalized config route.
create or replace function public.strip_legacy_dust_authority()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.state #> '{settings,dust}' is not null then
    new.state := new.state #- '{settings,dust}';
  end if;
  return new;
end;
$$;

revoke all on function public.strip_legacy_dust_authority()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists workspace_state_strip_legacy_dust_authority on public.workspace_state;
create trigger workspace_state_strip_legacy_dust_authority
  before insert or update on public.workspace_state
  for each row execute function public.strip_legacy_dust_authority();

update public.workspace_state
set state = state #- '{settings,dust}'
where state #> '{settings,dust}' is not null;
