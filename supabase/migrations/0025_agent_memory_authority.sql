-- 0025_agent_memory_authority.sql
-- Agent memory is exact-scope execution authority. It is never sourced from
-- the shared workspace_state document or inferred from a sender seat.

-- --------------------------------------------------------------------------
-- Immutable agent-spec authority and exact run ownership
-- --------------------------------------------------------------------------

create unique index if not exists agent_specs_workspace_owner_id_key
  on public.agent_specs (workspace_id, owner_id, id);

create or replace function public.enforce_agent_spec_authority_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.owner_id is distinct from old.owner_id then
    raise exception 'agent spec workspace_id and owner_id authority is immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_agent_spec_authority_immutable()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists agent_specs_authority_immutable on public.agent_specs;
create trigger agent_specs_authority_immutable
  before update on public.agent_specs
  for each row execute function public.enforce_agent_spec_authority_immutable();

alter table public.agent_runs
  add column if not exists owner_id uuid references auth.users(id) on delete restrict;

-- Reconcile legacy run rows to their spec. The spec is the canonical authority;
-- the old independently supplied workspace_id was never trustworthy.
update public.agent_runs as run
   set workspace_id = spec.workspace_id,
       owner_id = spec.owner_id
  from public.agent_specs as spec
 where spec.id = run.spec_id
   and (
     run.workspace_id is distinct from spec.workspace_id
     or run.owner_id is distinct from spec.owner_id
   );

update public.agent_events as event
   set workspace_id = run.workspace_id
  from public.agent_runs as run
 where run.id = event.run_id
   and event.workspace_id is distinct from run.workspace_id;

alter table public.agent_runs alter column owner_id set not null;

alter table public.agent_runs
  drop constraint if exists agent_runs_spec_id_fkey;
alter table public.agent_runs
  add constraint agent_runs_workspace_owner_spec_fkey
  foreign key (workspace_id, owner_id, spec_id)
  references public.agent_specs (workspace_id, owner_id, id)
  on delete cascade;

create unique index if not exists agent_runs_workspace_owner_spec_id_key
  on public.agent_runs (workspace_id, owner_id, spec_id, id);

-- Agent specs are visible only to the exact owner or a workspace admin.
drop policy if exists agent_specs_select on public.agent_specs;
create policy agent_specs_select on public.agent_specs
  for select to authenticated
  using (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() <> 'viewer'
    and (owner_id = auth.uid() or public.current_profile_role() = 'admin')
  );

drop policy if exists agent_specs_insert on public.agent_specs;
create policy agent_specs_insert on public.agent_specs
  for insert to authenticated
  with check (
    workspace_id = public.current_workspace_id()
    and owner_id = auth.uid()
    and public.current_profile_role() <> 'viewer'
  );

drop policy if exists agent_specs_update on public.agent_specs;
create policy agent_specs_update on public.agent_specs
  for update to authenticated
  using (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() <> 'viewer'
    and (owner_id = auth.uid() or public.current_profile_role() = 'admin')
  )
  with check (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() <> 'viewer'
    and (owner_id = auth.uid() or public.current_profile_role() = 'admin')
  );

revoke update on public.agent_specs from authenticated;
grant update (
  name, role_brief, channels, guardrails, flowise_chatflow_id, seat_id, status,
  updated_at
) on public.agent_specs to authenticated;

-- Runs and narration are server-created. Users may only read their exact scope.
drop policy if exists agent_runs_select on public.agent_runs;
create policy agent_runs_select on public.agent_runs
  for select to authenticated
  using (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() <> 'viewer'
    and (owner_id = auth.uid() or public.current_profile_role() = 'admin')
  );
drop policy if exists agent_runs_insert on public.agent_runs;
drop policy if exists agent_runs_update on public.agent_runs;

revoke insert, update, delete on public.agent_runs from authenticated;
grant select, insert, update, delete on public.agent_runs to service_role;

drop policy if exists agent_events_select on public.agent_events;
create policy agent_events_select on public.agent_events
  for select to authenticated
  using (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() <> 'viewer'
    and exists (
      select 1
        from public.agent_runs as run
       where run.id = agent_events.run_id
         and run.workspace_id = agent_events.workspace_id
         and (run.owner_id = auth.uid() or public.current_profile_role() = 'admin')
    )
  );
drop policy if exists agent_events_insert on public.agent_events;

revoke insert, update, delete on public.agent_events from authenticated;
grant select, insert, update, delete on public.agent_events to service_role;

-- --------------------------------------------------------------------------
-- Normalized encrypted memory, content-free audit, and run receipts
-- --------------------------------------------------------------------------

create table if not exists public.agent_memories (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  owner_id            uuid not null references auth.users(id) on delete restrict,
  spec_id             uuid not null,
  kind                text not null check (length(btrim(kind)) between 1 and 64),
  content_ciphertext  text not null check (
    content_ciphertext ~ '^enc:v2:[0-9a-f]{64}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$'
  ),
  content_sha256      text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  revision            integer not null default 1 check (revision > 0),
  status              text not null default 'pending_review'
                      check (status in ('pending_review', 'approved', 'rejected', 'deleted')),
  source_type         text not null default 'operator'
                      check (source_type in ('operator', 'run', 'import')),
  source_run_id       uuid,
  pinned              boolean not null default false,
  expires_at          timestamptz,
  created_by          uuid references auth.users(id) on delete set null,
  updated_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,

  constraint agent_memories_workspace_owner_spec_fkey
    foreign key (workspace_id, owner_id, spec_id)
    references public.agent_specs (workspace_id, owner_id, id)
    on delete cascade,
  constraint agent_memories_source_run_fkey
    foreign key (workspace_id, owner_id, spec_id, source_run_id)
    references public.agent_runs (workspace_id, owner_id, spec_id, id)
    on delete restrict,
  constraint agent_memories_source_binding_check
    check ((source_type = 'run') = (source_run_id is not null)),
  constraint agent_memories_deleted_state_check
    check ((status = 'deleted') = (deleted_at is not null))
);

create unique index if not exists agent_memories_scope_identity_key
  on public.agent_memories (
    workspace_id, owner_id, spec_id, id, revision, content_sha256
  );
create index if not exists agent_memories_runtime_lookup_idx
  on public.agent_memories (
    workspace_id, owner_id, spec_id, status, pinned desc, updated_at desc
  ) where deleted_at is null;

create table if not exists public.agent_run_memory_context (
  run_id            uuid not null,
  workspace_id      uuid not null,
  owner_id          uuid not null,
  spec_id           uuid not null,
  memory_id         uuid not null,
  memory_revision   integer not null check (memory_revision > 0),
  content_sha256    text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  position          integer not null check (position between 0 and 7),
  byte_count        integer not null check (byte_count between 1 and 8192),
  selected_at       timestamptz not null default now(),

  primary key (run_id, memory_id),
  unique (run_id, position),
  constraint agent_run_memory_context_run_fkey
    foreign key (workspace_id, owner_id, spec_id, run_id)
    references public.agent_runs (workspace_id, owner_id, spec_id, id)
    on delete cascade,
  constraint agent_run_memory_context_memory_fkey
    foreign key (
      workspace_id, owner_id, spec_id, memory_id, memory_revision, content_sha256
    ) references public.agent_memories (
      workspace_id, owner_id, spec_id, id, revision, content_sha256
    ) on delete restrict
);

create table if not exists public.agent_memory_events (
  id                bigint generated always as identity primary key,
  memory_id         uuid not null,
  workspace_id      uuid not null,
  owner_id          uuid not null,
  spec_id           uuid not null,
  run_id            uuid,
  actor_id           uuid references auth.users(id) on delete set null,
  event_type        text not null check (event_type in ('created', 'approved', 'rejected', 'used', 'expired', 'deleted')),
  memory_revision   integer not null check (memory_revision > 0),
  content_sha256    text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  metadata          jsonb not null default '{}'::jsonb check (metadata = '{}'::jsonb),
  created_at        timestamptz not null default now(),

  constraint agent_memory_events_memory_fkey
    foreign key (
      workspace_id, owner_id, spec_id, memory_id, memory_revision, content_sha256
    ) references public.agent_memories (
      workspace_id, owner_id, spec_id, id, revision, content_sha256
    ) on delete restrict,
  constraint agent_memory_events_run_fkey
    foreign key (workspace_id, owner_id, spec_id, run_id)
    references public.agent_runs (workspace_id, owner_id, spec_id, id)
    on delete cascade
);

create index if not exists agent_memory_events_scope_idx
  on public.agent_memory_events (workspace_id, owner_id, spec_id, created_at desc);

create or replace function public.enforce_agent_memory_authority_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.owner_id is distinct from old.owner_id
     or new.spec_id is distinct from old.spec_id
     or new.source_run_id is distinct from old.source_run_id then
    raise exception 'agent memory workspace, owner, spec, and source authority is immutable'
      using errcode = '42501';
  end if;
  if new.content_ciphertext is distinct from old.content_ciphertext
     or new.content_sha256 is distinct from old.content_sha256 then
    new.revision := old.revision + 1;
  else
    new.revision := old.revision;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.enforce_agent_memory_authority_immutable()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists agent_memories_authority_immutable on public.agent_memories;
create trigger agent_memories_authority_immutable
  before update on public.agent_memories
  for each row execute function public.enforce_agent_memory_authority_immutable();

create or replace function public.reject_agent_memory_audit_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'agent memory audit and receipt rows are append-only'
    using errcode = '42501';
end;
$$;

revoke all on function public.reject_agent_memory_audit_mutation()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists agent_memory_events_append_only on public.agent_memory_events;
create trigger agent_memory_events_append_only
  before update or delete on public.agent_memory_events
  for each row execute function public.reject_agent_memory_audit_mutation();

drop trigger if exists agent_run_memory_context_append_only on public.agent_run_memory_context;
create trigger agent_run_memory_context_append_only
  before update or delete on public.agent_run_memory_context
  for each row execute function public.reject_agent_memory_audit_mutation();

alter table public.agent_memories enable row level security;
alter table public.agent_memories force row level security;
alter table public.agent_run_memory_context enable row level security;
alter table public.agent_run_memory_context force row level security;
alter table public.agent_memory_events enable row level security;
alter table public.agent_memory_events force row level security;

revoke all on public.agent_memories
  from public, anon, authenticated, service_role, authenticator;
revoke all on public.agent_run_memory_context
  from public, anon, authenticated, service_role, authenticator;
revoke all on public.agent_memory_events
  from public, anon, authenticated, service_role, authenticator;

grant select (
  id, workspace_id, owner_id, spec_id, kind, content_sha256, revision, status,
  source_type, source_run_id, pinned, expires_at, created_by, updated_by,
  created_at, updated_at, deleted_at
) on public.agent_memories to authenticated;
grant select on public.agent_run_memory_context to authenticated;
grant select on public.agent_memory_events to authenticated;

grant select, insert, update, delete on public.agent_memories to service_role;
grant select, insert on public.agent_run_memory_context to service_role;
grant select, insert on public.agent_memory_events to service_role;
grant usage, select on sequence public.agent_memory_events_id_seq to service_role;

drop policy if exists agent_memories_owner_metadata on public.agent_memories;
create policy agent_memories_owner_metadata on public.agent_memories
  for select to authenticated
  using (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() <> 'viewer'
    and (owner_id = auth.uid() or public.current_profile_role() = 'admin')
  );
create policy agent_memories_postgres_all on public.agent_memories
  for all to postgres using (true) with check (true);

drop policy if exists agent_run_memory_context_owner_read on public.agent_run_memory_context;
create policy agent_run_memory_context_owner_read on public.agent_run_memory_context
  for select to authenticated
  using (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() <> 'viewer'
    and (owner_id = auth.uid() or public.current_profile_role() = 'admin')
  );
create policy agent_run_memory_context_postgres_all on public.agent_run_memory_context
  for all to postgres using (true) with check (true);

drop policy if exists agent_memory_events_owner_read on public.agent_memory_events;
create policy agent_memory_events_owner_read on public.agent_memory_events
  for select to authenticated
  using (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() <> 'viewer'
    and (owner_id = auth.uid() or public.current_profile_role() = 'admin')
  );
create policy agent_memory_events_postgres_all on public.agent_memory_events
  for all to postgres using (true) with check (true);

-- --------------------------------------------------------------------------
-- Quarantine legacy seat-keyed workspace memory, never activate it
-- --------------------------------------------------------------------------

create table if not exists public.agent_memory_legacy_quarantine (
  id                  bigint generated always as identity primary key,
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  legacy_memory_id    text not null,
  legacy_seat_id      text,
  payload             jsonb not null,
  payload_sha256      text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  source_updated_at   timestamptz,
  quarantine_reason   text not null default 'ambiguous_seat_scope',
  quarantined_at      timestamptz not null default now(),
  unique (workspace_id, payload_sha256)
);

alter table public.agent_memory_legacy_quarantine enable row level security;
alter table public.agent_memory_legacy_quarantine force row level security;
revoke all on public.agent_memory_legacy_quarantine
  from public, anon, authenticated, service_role, authenticator;
grant select on public.agent_memory_legacy_quarantine to service_role;
grant usage, select on sequence public.agent_memory_legacy_quarantine_id_seq to service_role;
create policy agent_memory_legacy_quarantine_postgres_all
  on public.agent_memory_legacy_quarantine
  for all to postgres using (true) with check (true);

insert into public.agent_memory_legacy_quarantine (
  workspace_id, legacy_memory_id, legacy_seat_id, payload, payload_sha256,
  source_updated_at
)
select state.workspace_id,
       coalesce(nullif(memory.payload ->> 'id', ''), encode(digest(memory.payload::text, 'sha256'), 'hex')),
       nullif(memory.payload ->> 'seatId', ''),
       memory.payload,
       encode(digest(memory.payload::text, 'sha256'), 'hex'),
       state.updated_at
  from public.workspace_state as state
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(state.state -> 'memory') = 'array'
         then state.state -> 'memory'
         else '[]'::jsonb
    end
  ) as memory(payload)
on conflict (workspace_id, payload_sha256) do nothing;

create or replace function public.strip_legacy_agent_memory_authority()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.state := jsonb_set(coalesce(new.state, '{}'::jsonb), '{memory}', '[]'::jsonb, true);
  return new;
end;
$$;

revoke all on function public.strip_legacy_agent_memory_authority()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists workspace_state_strip_agent_memory_authority on public.workspace_state;
create trigger workspace_state_strip_agent_memory_authority
  before insert or update on public.workspace_state
  for each row execute function public.strip_legacy_agent_memory_authority();

update public.workspace_state
   set state = jsonb_set(coalesce(state, '{}'::jsonb), '{memory}', '[]'::jsonb, true)
 where state -> 'memory' is distinct from '[]'::jsonb;

-- --------------------------------------------------------------------------
-- One service-only transaction creates the run and immutable memory receipts
-- --------------------------------------------------------------------------

create or replace function public.create_agent_run_with_memory_context(
  p_workspace_id uuid,
  p_owner_id uuid,
  p_spec_id uuid,
  p_actor_id uuid,
  p_receipts jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  run_id uuid;
  locked_spec_id uuid;
  receipt jsonb;
  memory_row public.agent_memories%rowtype;
  receipt_count integer;
  total_bytes integer := 0;
  receipt_position integer;
  receipt_bytes integer;
  receipt_memory_id uuid;
  receipt_revision integer;
  receipt_hash text;
begin
  if jsonb_typeof(p_receipts) is distinct from 'array' then
    raise exception 'memory receipts must be a JSON array' using errcode = '22023';
  end if;

  receipt_count := jsonb_array_length(p_receipts);
  if receipt_count > 8 then
    raise exception 'memory receipt item limit exceeded' using errcode = '22023';
  end if;

  select spec.id into locked_spec_id
    from public.agent_specs as spec
   where spec.id = p_spec_id
     and spec.workspace_id = p_workspace_id
     and spec.owner_id = p_owner_id
     and spec.status = 'active'
   for share;
  if not found then
    raise exception 'active exact-scope agent spec not found' using errcode = '22023';
  end if;

  if not exists (
    select 1
      from public.profiles
     where id = p_actor_id
       and workspace_id = p_workspace_id
       and role = 'admin'
  ) then
    raise exception 'run actor lacks workspace admin authority' using errcode = '22023';
  end if;

  for receipt in select value from jsonb_array_elements(p_receipts)
  loop
    if jsonb_typeof(receipt) is distinct from 'object'
       or exists (
         select 1 from jsonb_object_keys(receipt) as key(name)
          where key.name not in ('memoryId', 'memoryRevision', 'contentSha256', 'position', 'byteCount')
       ) then
      raise exception 'invalid memory receipt shape' using errcode = '22023';
    end if;

    begin
      receipt_memory_id := (receipt ->> 'memoryId')::uuid;
      receipt_revision := (receipt ->> 'memoryRevision')::integer;
      receipt_hash := receipt ->> 'contentSha256';
      receipt_position := (receipt ->> 'position')::integer;
      receipt_bytes := (receipt ->> 'byteCount')::integer;
    exception when others then
      raise exception 'invalid memory receipt values' using errcode = '22023';
    end;

    if receipt_revision < 1
       or receipt_position < 0 or receipt_position >= receipt_count
       or receipt_bytes < 1 or receipt_bytes > 8192
       or receipt_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'invalid memory receipt values' using errcode = '22023';
    end if;

    total_bytes := total_bytes + receipt_bytes;
    if total_bytes > 8192 then
      raise exception 'memory receipt byte limit exceeded' using errcode = '22023';
    end if;

    select memory.* into memory_row
      from public.agent_memories as memory
     where memory.id = receipt_memory_id
       and memory.workspace_id = p_workspace_id
       and memory.owner_id = p_owner_id
       and memory.spec_id = p_spec_id
       and memory.revision = receipt_revision
       and memory.content_sha256 = receipt_hash
       and memory.status = 'approved'
       and memory.deleted_at is null
       and (memory.expires_at is null or memory.expires_at > now())
     for share;

    if not found then
      raise exception 'memory receipt is stale or outside active authority'
        using errcode = '22023';
    end if;
  end loop;

  insert into public.agent_runs (workspace_id, owner_id, spec_id, state_json, node)
  values (p_workspace_id, p_owner_id, p_spec_id, '{}'::jsonb, 'planner')
  returning id into run_id;

  for receipt in select value from jsonb_array_elements(p_receipts)
  loop
    receipt_memory_id := (receipt ->> 'memoryId')::uuid;
    receipt_revision := (receipt ->> 'memoryRevision')::integer;
    receipt_hash := receipt ->> 'contentSha256';
    receipt_position := (receipt ->> 'position')::integer;
    receipt_bytes := (receipt ->> 'byteCount')::integer;

    insert into public.agent_run_memory_context (
      run_id, workspace_id, owner_id, spec_id, memory_id, memory_revision,
      content_sha256, position, byte_count
    ) values (
      run_id, p_workspace_id, p_owner_id, p_spec_id, receipt_memory_id,
      receipt_revision, receipt_hash, receipt_position, receipt_bytes
    );

    insert into public.agent_memory_events (
      memory_id, workspace_id, owner_id, spec_id, run_id, actor_id,
      event_type, memory_revision, content_sha256, metadata
    ) values (
      receipt_memory_id, p_workspace_id, p_owner_id, p_spec_id, run_id,
      p_actor_id, 'used', receipt_revision, receipt_hash, '{}'::jsonb
    );
  end loop;

  return run_id;
end;
$$;

revoke all on function public.create_agent_run_with_memory_context(uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, authenticator;
grant execute on function public.create_agent_run_with_memory_context(uuid, uuid, uuid, uuid, jsonb)
  to service_role;
