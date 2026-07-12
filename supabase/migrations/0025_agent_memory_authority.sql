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
alter table public.agent_runs
  add column if not exists actor_id uuid;

create unique index if not exists profiles_workspace_id_id_key
  on public.profiles (workspace_id, id);

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
  drop constraint if exists agent_runs_workspace_owner_spec_fkey;
alter table public.agent_runs
  add constraint agent_runs_workspace_owner_spec_fkey
  foreign key (workspace_id, owner_id, spec_id)
  references public.agent_specs (workspace_id, owner_id, id)
  on delete cascade;
alter table public.agent_runs
  drop constraint if exists agent_runs_workspace_actor_fkey;
alter table public.agent_runs
  add constraint agent_runs_workspace_actor_fkey
  foreign key (workspace_id, actor_id)
  references public.profiles (workspace_id, id)
  on delete restrict;

create unique index if not exists agent_runs_workspace_owner_spec_id_key
  on public.agent_runs (workspace_id, owner_id, spec_id, id);

create or replace function public.enforce_agent_run_authority_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.actor_id is null then
      raise exception 'new agent runs require actor provenance'
        using errcode = '23502';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.owner_id is distinct from old.owner_id
     or new.spec_id is distinct from old.spec_id
     or new.actor_id is distinct from old.actor_id
     or new.started_at is distinct from old.started_at then
    raise exception 'agent run workspace, owner, spec, and actor authority is immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_agent_run_authority_immutable()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists agent_runs_authority_immutable on public.agent_runs;
create trigger agent_runs_authority_immutable
  before insert or update on public.agent_runs
  for each row execute function public.enforce_agent_run_authority_immutable();

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

revoke insert, update, delete on public.agent_runs from authenticated, service_role;
grant select, update, delete on public.agent_runs to service_role;

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
  content_byte_count  integer not null,
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
    check ((status = 'deleted') = (deleted_at is not null)),
  constraint agent_memories_content_byte_count_check
    check (content_byte_count between 1 and 8192)
);

-- Safe reconciliation if a prior interrupted attempt created the table before
-- the byte-count authority column. Such rows are never left approved.
alter table public.agent_memories
  add column if not exists content_byte_count integer;
update public.agent_memories
   set content_byte_count = 1,
       status = 'pending_review',
       deleted_at = null
 where content_byte_count is null;
alter table public.agent_memories alter column content_byte_count set not null;
alter table public.agent_memories
  drop constraint if exists agent_memories_content_byte_count_check;
alter table public.agent_memories
  add constraint agent_memories_content_byte_count_check
  check (content_byte_count between 1 and 8192);

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
  event_type        text not null,
  memory_revision   integer not null check (memory_revision > 0),
  content_sha256    text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  metadata          jsonb not null default '{}'::jsonb check (metadata = '{}'::jsonb),
  created_at        timestamptz not null default now(),

  constraint agent_memory_events_event_type_check
    check (event_type in ('created', 'approved', 'rejected', 'selected', 'used', 'expired', 'deleted')),
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

alter table public.agent_memory_events
  drop constraint if exists agent_memory_events_event_type_check;
alter table public.agent_memory_events
  add constraint agent_memory_events_event_type_check
  check (event_type in ('created', 'approved', 'rejected', 'selected', 'used', 'expired', 'deleted'));

-- CREATE TABLE IF NOT EXISTS does not repair a partially created table. Guard
-- every named constraint so a ledger retry restores the full authority model.
do $agent_memory_constraint_reconciliation$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'agent_memories_workspace_owner_spec_fkey'
       and conrelid = 'public.agent_memories'::regclass
  ) then
    alter table public.agent_memories
      add constraint agent_memories_workspace_owner_spec_fkey
      foreign key (workspace_id, owner_id, spec_id)
      references public.agent_specs (workspace_id, owner_id, id)
      on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'agent_memories_source_run_fkey'
       and conrelid = 'public.agent_memories'::regclass
  ) then
    alter table public.agent_memories
      add constraint agent_memories_source_run_fkey
      foreign key (workspace_id, owner_id, spec_id, source_run_id)
      references public.agent_runs (workspace_id, owner_id, spec_id, id)
      on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'agent_memories_source_binding_check'
       and conrelid = 'public.agent_memories'::regclass
  ) then
    alter table public.agent_memories
      add constraint agent_memories_source_binding_check
      check ((source_type = 'run') = (source_run_id is not null));
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'agent_memories_deleted_state_check'
       and conrelid = 'public.agent_memories'::regclass
  ) then
    alter table public.agent_memories
      add constraint agent_memories_deleted_state_check
      check ((status = 'deleted') = (deleted_at is not null));
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'agent_run_memory_context_run_fkey'
       and conrelid = 'public.agent_run_memory_context'::regclass
  ) then
    alter table public.agent_run_memory_context
      add constraint agent_run_memory_context_run_fkey
      foreign key (workspace_id, owner_id, spec_id, run_id)
      references public.agent_runs (workspace_id, owner_id, spec_id, id)
      on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'agent_run_memory_context_memory_fkey'
       and conrelid = 'public.agent_run_memory_context'::regclass
  ) then
    alter table public.agent_run_memory_context
      add constraint agent_run_memory_context_memory_fkey
      foreign key (
        workspace_id, owner_id, spec_id, memory_id, memory_revision, content_sha256
      ) references public.agent_memories (
        workspace_id, owner_id, spec_id, id, revision, content_sha256
      ) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'agent_memory_events_memory_fkey'
       and conrelid = 'public.agent_memory_events'::regclass
  ) then
    alter table public.agent_memory_events
      add constraint agent_memory_events_memory_fkey
      foreign key (
        workspace_id, owner_id, spec_id, memory_id, memory_revision, content_sha256
      ) references public.agent_memories (
        workspace_id, owner_id, spec_id, id, revision, content_sha256
      ) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'agent_memory_events_run_fkey'
       and conrelid = 'public.agent_memory_events'::regclass
  ) then
    alter table public.agent_memory_events
      add constraint agent_memory_events_run_fkey
      foreign key (workspace_id, owner_id, spec_id, run_id)
      references public.agent_runs (workspace_id, owner_id, spec_id, id)
      on delete cascade;
  end if;
end
$agent_memory_constraint_reconciliation$;

create index if not exists agent_memory_events_scope_idx
  on public.agent_memory_events (workspace_id, owner_id, spec_id, created_at desc);

create or replace function public.enforce_agent_memory_authority_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  ciphertext_changed boolean := new.content_ciphertext is distinct from old.content_ciphertext;
  hash_changed boolean := new.content_sha256 is distinct from old.content_sha256;
  kind_changed boolean := new.kind is distinct from old.kind;
begin
  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.owner_id is distinct from old.owner_id
     or new.spec_id is distinct from old.spec_id
     or new.source_type is distinct from old.source_type
     or new.source_run_id is distinct from old.source_run_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'agent memory workspace, owner, spec, and source authority is immutable'
      using errcode = '42501';
  end if;

  if ciphertext_changed is distinct from hash_changed then
    raise exception 'agent memory ciphertext and hash must change together'
      using errcode = '22023';
  end if;
  if new.content_byte_count is distinct from old.content_byte_count
     and not ciphertext_changed then
    raise exception 'agent memory byte count cannot change without content'
      using errcode = '22023';
  end if;
  if old.status = 'deleted' and (ciphertext_changed or kind_changed) then
    raise exception 'deleted agent memory content is immutable'
      using errcode = '42501';
  end if;

  if new.content_ciphertext is distinct from old.content_ciphertext
     or new.content_sha256 is distinct from old.content_sha256
     or kind_changed then
    new.revision := old.revision + 1;
    new.status := 'pending_review';
    new.deleted_at := null;
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
  id, workspace_id, owner_id, spec_id, kind, content_sha256, content_byte_count, revision, status,
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
drop policy if exists agent_memories_postgres_all on public.agent_memories;
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
drop policy if exists agent_run_memory_context_postgres_all on public.agent_run_memory_context;
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
drop policy if exists agent_memory_events_postgres_all on public.agent_memory_events;
create policy agent_memory_events_postgres_all on public.agent_memory_events
  for all to postgres using (true) with check (true);

-- --------------------------------------------------------------------------
-- Quarantine legacy seat-keyed workspace memory, never activate it
-- --------------------------------------------------------------------------

create table if not exists public.agent_memory_legacy_quarantine (
  id                  bigint generated always as identity primary key,
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  payload_sha256      text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  source_updated_at   timestamptz,
  quarantine_reason   text not null default 'ambiguous_seat_scope',
  quarantined_at      timestamptz not null default now(),
  unique (workspace_id, payload_sha256)
);

-- Reconcile and scrub any interrupted pre-release attempt that used a
-- recoverable quarantine payload. Only the one-way receipt may remain.
alter table public.agent_memory_legacy_quarantine drop column if exists payload;
alter table public.agent_memory_legacy_quarantine drop column if exists legacy_memory_id;
alter table public.agent_memory_legacy_quarantine drop column if exists legacy_seat_id;

alter table public.agent_memory_legacy_quarantine enable row level security;
alter table public.agent_memory_legacy_quarantine force row level security;
revoke all on public.agent_memory_legacy_quarantine
  from public, anon, authenticated, service_role, authenticator;
grant select on public.agent_memory_legacy_quarantine to service_role;
grant usage, select on sequence public.agent_memory_legacy_quarantine_id_seq to service_role;
drop policy if exists agent_memory_legacy_quarantine_postgres_all on public.agent_memory_legacy_quarantine;
create policy agent_memory_legacy_quarantine_postgres_all
  on public.agent_memory_legacy_quarantine
  for all to postgres using (true) with check (true);

insert into public.agent_memory_legacy_quarantine (
  workspace_id, payload_sha256, source_updated_at
)
select state.workspace_id,
       encode(
         digest(state.workspace_id::text || ':' || memory.memory_payload::text, 'sha256'),
         'hex'
       ),
       state.updated_at
  from public.workspace_state as state
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(state.state -> 'memory') = 'array'
         then state.state -> 'memory'
         else '[]'::jsonb
    end
  ) as memory(memory_payload)
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

drop function if exists public.create_agent_run_with_memory_context(uuid, uuid, uuid, uuid, jsonb);

create or replace function public.create_agent_run_with_memory_context(
  p_workspace_id uuid,
  p_owner_id uuid,
  p_spec_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  run_id uuid;
  locked_actor_id uuid;
  locked_spec_id uuid;
  memory_row public.agent_memories%rowtype;
  selected_count integer := 0;
  total_bytes integer := 0;
begin
  -- Lock the actor first so a concurrent admin revocation wins before any run
  -- or memory authority is persisted.
  select profile.id into locked_actor_id
    from public.profiles as profile
   where profile.id = p_actor_id
     and profile.workspace_id = p_workspace_id
     and profile.role = 'admin'
   for share;
  if not found then
    raise exception 'run actor lacks workspace admin authority' using errcode = '22023';
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

  insert into public.agent_runs (
    workspace_id, owner_id, spec_id, actor_id, state_json, node
  ) values (
    p_workspace_id, p_owner_id, p_spec_id, p_actor_id, '{}'::jsonb, 'planner'
  ) returning id into run_id;

  -- PostgreSQL, not the caller, selects the exact approved snapshot. The actor,
  -- spec, and selected rows stay locked until this function commits.
  for memory_row in
    select memory.*
      from public.agent_memories as memory
     where memory.workspace_id = p_workspace_id
       and memory.owner_id = p_owner_id
       and memory.spec_id = p_spec_id
       and memory.status = 'approved'
       and memory.deleted_at is null
       and (memory.expires_at is null or memory.expires_at > now())
     order by memory.pinned desc, memory.updated_at desc, memory.id
     for share
  loop
    exit when selected_count >= 8;
    if total_bytes + memory_row.content_byte_count > 8192 then
      continue;
    end if;

    insert into public.agent_run_memory_context (
      run_id, workspace_id, owner_id, spec_id, memory_id, memory_revision,
      content_sha256, position, byte_count
    ) values (
      run_id, p_workspace_id, p_owner_id, p_spec_id, memory_row.id,
      memory_row.revision, memory_row.content_sha256, selected_count,
      memory_row.content_byte_count
    );

    insert into public.agent_memory_events (
      memory_id, workspace_id, owner_id, spec_id, run_id, actor_id,
      event_type, memory_revision, content_sha256, metadata
    ) values (
      memory_row.id, p_workspace_id, p_owner_id, p_spec_id, run_id,
      p_actor_id, 'selected', memory_row.revision, memory_row.content_sha256,
      '{}'::jsonb
    );

    total_bytes := total_bytes + memory_row.content_byte_count;
    selected_count := selected_count + 1;
  end loop;

  return run_id;
end;
$$;

revoke all on function public.create_agent_run_with_memory_context(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.create_agent_run_with_memory_context(uuid, uuid, uuid, uuid)
  to service_role;
