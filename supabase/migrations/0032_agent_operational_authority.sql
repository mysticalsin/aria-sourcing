-- 0032_agent_operational_authority.sql
-- Exact tenant/seat bindings plus owner-scoped, encrypted AgentSpec memory
-- management and immutable framework-run memory receipts.

-- --------------------------------------------------------------------------
-- Seat bindings carry the workspace in the foreign key. Legacy mismatches are
-- neutralized before validation so a global UUID can never bridge tenants.
-- --------------------------------------------------------------------------

create unique index if not exists agent_seats_workspace_id_id_key
  on public.agent_seats (workspace_id, id);

update public.agent_specs as spec
   set seat_id = null
  from public.agent_seats as seat
 where spec.seat_id = seat.id
   and seat.workspace_id <> spec.workspace_id;

update public.messages_outbound as message
   set seat_id = null
  from public.agent_seats as seat
 where message.seat_id = seat.id
   and seat.workspace_id <> message.workspace_id;

update public.whatsapp_senders as sender
   set seat_id = null
  from public.agent_seats as seat
 where sender.seat_id = seat.id
   and seat.workspace_id <> sender.workspace_id;

-- A mismatched OAuth connection cannot be moved to the seat's tenant because
-- that would reassign credentials across a security boundary. Persist only a
-- content-free receipt, then disconnect the invalid live credential.
create table if not exists public.email_connection_seat_mismatch_quarantine (
  connection_id uuid primary key,
  quarantine_reason text not null default 'cross_workspace_seat_binding'
    check (quarantine_reason = 'cross_workspace_seat_binding'),
  quarantined_at timestamptz not null default now()
);

-- A previous successful application leaves the append-only trigger in place.
-- Remove it before the migration's own idempotent reconciliation writes.
drop trigger if exists email_connection_seat_mismatch_quarantine_append_only
  on public.email_connection_seat_mismatch_quarantine;

-- Reconcile any interrupted pre-release attempt that retained reversible or
-- dictionary-attackable metadata. Only the opaque connection receipt remains.
alter table public.email_connection_seat_mismatch_quarantine
  add column if not exists quarantine_reason text;
update public.email_connection_seat_mismatch_quarantine
   set quarantine_reason = 'cross_workspace_seat_binding'
 where quarantine_reason is distinct from 'cross_workspace_seat_binding';
alter table public.email_connection_seat_mismatch_quarantine
  alter column quarantine_reason set default 'cross_workspace_seat_binding';
alter table public.email_connection_seat_mismatch_quarantine
  alter column quarantine_reason set not null;
alter table public.email_connection_seat_mismatch_quarantine
  drop constraint if exists email_connection_seat_mismatch_quarantine_quarantine_reason_check;
alter table public.email_connection_seat_mismatch_quarantine
  add constraint email_connection_seat_mismatch_quarantine_quarantine_reason_check
  check (quarantine_reason = 'cross_workspace_seat_binding');
alter table public.email_connection_seat_mismatch_quarantine
  add column if not exists quarantined_at timestamptz;
update public.email_connection_seat_mismatch_quarantine
   set quarantined_at = now()
 where quarantined_at is null;
alter table public.email_connection_seat_mismatch_quarantine
  alter column quarantined_at set default now();
alter table public.email_connection_seat_mismatch_quarantine
  alter column quarantined_at set not null;
alter table public.email_connection_seat_mismatch_quarantine
  drop column if exists claimed_workspace_id;
alter table public.email_connection_seat_mismatch_quarantine
  drop column if exists seat_workspace_id;
alter table public.email_connection_seat_mismatch_quarantine
  drop column if exists provider;
alter table public.email_connection_seat_mismatch_quarantine
  drop column if exists account_email_sha256;

alter table public.email_connection_seat_mismatch_quarantine enable row level security;
alter table public.email_connection_seat_mismatch_quarantine force row level security;
revoke all on public.email_connection_seat_mismatch_quarantine
  from public, anon, authenticated, service_role, authenticator;
grant select on public.email_connection_seat_mismatch_quarantine to service_role;
drop policy if exists email_connection_seat_mismatch_quarantine_postgres_all
  on public.email_connection_seat_mismatch_quarantine;
create policy email_connection_seat_mismatch_quarantine_postgres_all
  on public.email_connection_seat_mismatch_quarantine
  for all to postgres using (true) with check (true);

create or replace function public.reject_email_connection_quarantine_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'email connection mismatch receipts are append-only'
    using errcode = '42501';
end;
$$;
revoke all on function public.reject_email_connection_quarantine_mutation()
  from public, anon, authenticated, service_role, authenticator;

create trigger email_connection_seat_mismatch_quarantine_append_only
  before update or delete on public.email_connection_seat_mismatch_quarantine
  for each row execute function public.reject_email_connection_quarantine_mutation();

insert into public.email_connection_seat_mismatch_quarantine (
  connection_id
)
select connection.id
  from public.email_connections as connection
  join public.agent_seats as seat on seat.id = connection.seat_id
 where seat.workspace_id <> connection.workspace_id
on conflict (connection_id) do nothing;

delete from public.email_connections as connection
 using public.agent_seats as seat
 where connection.seat_id = seat.id
   and seat.workspace_id <> connection.workspace_id;

alter table public.agent_specs
  drop constraint if exists agent_specs_workspace_seat_fkey;
alter table public.agent_specs
  add constraint agent_specs_workspace_seat_fkey
  foreign key (workspace_id, seat_id)
  references public.agent_seats (workspace_id, id)
  on delete set null (seat_id)
  not valid;
alter table public.agent_specs
  validate constraint agent_specs_workspace_seat_fkey;

alter table public.messages_outbound
  drop constraint if exists messages_outbound_workspace_seat_fkey;
alter table public.messages_outbound
  add constraint messages_outbound_workspace_seat_fkey
  foreign key (workspace_id, seat_id)
  references public.agent_seats (workspace_id, id)
  on delete set null (seat_id)
  not valid;
alter table public.messages_outbound
  validate constraint messages_outbound_workspace_seat_fkey;

alter table public.whatsapp_senders
  drop constraint if exists whatsapp_senders_workspace_seat_fkey;
alter table public.whatsapp_senders
  add constraint whatsapp_senders_workspace_seat_fkey
  foreign key (workspace_id, seat_id)
  references public.agent_seats (workspace_id, id)
  on delete set null (seat_id)
  not valid;
alter table public.whatsapp_senders
  validate constraint whatsapp_senders_workspace_seat_fkey;

alter table public.email_connections
  drop constraint if exists email_connections_workspace_seat_fkey;
alter table public.email_connections
  add constraint email_connections_workspace_seat_fkey
  foreign key (workspace_id, seat_id)
  references public.agent_seats (workspace_id, id)
  on delete cascade
  not valid;
alter table public.email_connections
  validate constraint email_connections_workspace_seat_fkey;

-- --------------------------------------------------------------------------
-- Memory history references stable identity, not the mutable current revision.
-- The snapshot revision/hash remain immutable receipt fields, but must not block
-- a reviewed memory from being edited into a new pending revision.
-- --------------------------------------------------------------------------

create unique index if not exists agent_memories_workspace_owner_spec_id_key
  on public.agent_memories (workspace_id, owner_id, spec_id, id);

-- Every operator edit participates in optimistic concurrency. Content/kind
-- changes return to review; pin/expiry-only changes retain their review status
-- but still advance the revision so a stale PATCH cannot overwrite them.
create or replace function public.enforce_agent_memory_authority_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  ciphertext_changed boolean := new.content_ciphertext is distinct from old.content_ciphertext;
  hash_changed boolean := new.content_sha256 is distinct from old.content_sha256;
  kind_changed boolean := new.kind is distinct from old.kind;
  metadata_changed boolean := new.pinned is distinct from old.pinned
    or new.expires_at is distinct from old.expires_at;
  deleting boolean := new.status = 'deleted' and old.status <> 'deleted';
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

  if hash_changed and not ciphertext_changed then
    raise exception 'agent memory hash cannot change without ciphertext'
      using errcode = '22023';
  end if;
  if new.content_byte_count is distinct from old.content_byte_count
     and not hash_changed then
    raise exception 'agent memory byte count cannot change without a content digest change'
      using errcode = '22023';
  end if;
  if old.status = 'deleted' and (
       ciphertext_changed or kind_changed or metadata_changed
       or new.status is distinct from old.status
       or new.deleted_at is distinct from old.deleted_at
     ) then
    raise exception 'deleted agent memory content is immutable'
      using errcode = '42501';
  end if;
  if deleting and (
       not ciphertext_changed
       or new.deleted_at is null
       or new.pinned
       or new.expires_at is not null
     ) then
    raise exception 'agent memory deletion requires an erased, unpinned tombstone'
      using errcode = '22023';
  end if;

  if deleting or ciphertext_changed or kind_changed or metadata_changed then
    new.revision := old.revision + 1;
  else
    new.revision := old.revision;
  end if;
  if (hash_changed or kind_changed) and not deleting then
    new.status := 'pending_review';
    new.deleted_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.enforce_agent_memory_authority_immutable()
  from public, anon, authenticated, service_role, authenticator;

alter table public.agent_run_memory_context
  drop constraint if exists agent_run_memory_context_memory_fkey;
alter table public.agent_run_memory_context
  add constraint agent_run_memory_context_memory_fkey
  foreign key (workspace_id, owner_id, spec_id, memory_id)
  references public.agent_memories (workspace_id, owner_id, spec_id, id)
  on delete restrict;

alter table public.agent_memory_events
  drop constraint if exists agent_memory_events_memory_fkey;
alter table public.agent_memory_events
  add constraint agent_memory_events_memory_fkey
  foreign key (workspace_id, owner_id, spec_id, memory_id)
  references public.agent_memories (workspace_id, owner_id, spec_id, id)
  on delete restrict;

create unique index if not exists agent_framework_runs_scope_id_key
  on public.agent_framework_runs (workspace_id, owner_id, spec_id, id);

alter table public.agent_framework_runs
  add column if not exists memory_context_attached_at timestamptz;
alter table public.agent_framework_runs
  add column if not exists proposal_reports jsonb;
alter table public.agent_framework_runs
  drop constraint if exists agent_framework_runs_proposal_reports_check;
alter table public.agent_framework_runs
  add constraint agent_framework_runs_proposal_reports_check
  check (
    proposal_reports is null
    or case when jsonb_typeof(proposal_reports) = 'array' then
      jsonb_array_length(proposal_reports) = 1
        and jsonb_typeof(proposal_reports->0) = 'string'
        and char_length(proposal_reports->>0) between 1 and 500
        and proposal_reports->>0 = btrim(proposal_reports->>0)
        and proposal_reports->>0 !~ '[[:cntrl:]]'
      else false
    end
  );

alter table public.agent_memory_events
  add column if not exists framework_run_id uuid;
alter table public.agent_memory_events
  drop constraint if exists agent_memory_events_framework_run_fkey;
alter table public.agent_memory_events
  add constraint agent_memory_events_framework_run_fkey
  foreign key (workspace_id, owner_id, spec_id, framework_run_id)
  references public.agent_framework_runs (workspace_id, owner_id, spec_id, id)
  on delete cascade;
alter table public.agent_memory_events
  drop constraint if exists agent_memory_events_run_identity_check;
alter table public.agent_memory_events
  add constraint agent_memory_events_run_identity_check
  check (num_nonnulls(run_id, framework_run_id) <= 1);
alter table public.agent_memory_events
  drop constraint if exists agent_memory_events_event_type_check;
alter table public.agent_memory_events
  add constraint agent_memory_events_event_type_check
  check (event_type in (
    'created', 'updated', 'approved', 'rejected', 'selected', 'used',
    'expired', 'deleted'
  ));

create table if not exists public.agent_framework_run_memory_context (
  framework_run_id uuid not null,
  workspace_id uuid not null,
  owner_id uuid not null,
  spec_id uuid not null,
  memory_id uuid not null,
  memory_revision integer not null check (memory_revision > 0),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  position integer not null check (position between 0 and 7),
  byte_count integer not null check (byte_count between 1 and 8192),
  selected_at timestamptz not null default now(),

  primary key (framework_run_id, memory_id),
  unique (framework_run_id, position),
  constraint agent_framework_run_memory_context_run_fkey
    foreign key (workspace_id, owner_id, spec_id, framework_run_id)
    references public.agent_framework_runs (workspace_id, owner_id, spec_id, id)
    on delete cascade,
  constraint agent_framework_run_memory_context_memory_fkey
    foreign key (workspace_id, owner_id, spec_id, memory_id)
    references public.agent_memories (workspace_id, owner_id, spec_id, id)
    on delete restrict
);

drop trigger if exists agent_framework_run_memory_context_append_only
  on public.agent_framework_run_memory_context;
create trigger agent_framework_run_memory_context_append_only
  before update or delete on public.agent_framework_run_memory_context
  for each row execute function public.reject_agent_memory_audit_mutation();

alter table public.agent_framework_run_memory_context enable row level security;
alter table public.agent_framework_run_memory_context force row level security;
revoke all on public.agent_framework_run_memory_context
  from public, anon, authenticated, service_role, authenticator;
grant select on public.agent_framework_run_memory_context to authenticated;
grant select on public.agent_framework_run_memory_context to service_role;

drop policy if exists agent_framework_run_memory_context_owner_read
  on public.agent_framework_run_memory_context;
create policy agent_framework_run_memory_context_owner_read
  on public.agent_framework_run_memory_context
  for select to authenticated
  using (
    workspace_id = public.current_workspace_id()
    and owner_id = auth.uid()
    and public.current_profile_role() <> 'viewer'
  );
drop policy if exists agent_framework_run_memory_context_postgres_all
  on public.agent_framework_run_memory_context;
create policy agent_framework_run_memory_context_postgres_all
  on public.agent_framework_run_memory_context
  for all to postgres using (true) with check (true);

-- A short database lease closes the final memory-revocation race. The runtime
-- may send a receipted plaintext snapshot only while every referenced memory
-- is still the approved revision. Memory mutation and deletion take the same
-- row locks and fail with memory_in_use until the bounded egress finishes.
create table if not exists public.agent_framework_memory_egress_leases (
  id uuid primary key default gen_random_uuid(),
  framework_run_id uuid not null,
  run_lease_id uuid not null,
  workspace_id uuid not null,
  owner_id uuid not null,
  spec_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  released_at timestamptz,
  constraint agent_framework_memory_egress_run_fkey
    foreign key (workspace_id, owner_id, spec_id, framework_run_id)
    references public.agent_framework_runs (workspace_id, owner_id, spec_id, id)
    on delete cascade,
  constraint agent_framework_memory_egress_window_check
    check (
      expires_at > created_at
      and (released_at is null or released_at >= created_at)
    ),
  unique (framework_run_id, run_lease_id)
);

create index if not exists agent_framework_memory_egress_active_idx
  on public.agent_framework_memory_egress_leases (framework_run_id, expires_at)
  where released_at is null;

alter table public.agent_framework_memory_egress_leases enable row level security;
alter table public.agent_framework_memory_egress_leases force row level security;
revoke all on public.agent_framework_memory_egress_leases
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists agent_framework_memory_egress_postgres_all
  on public.agent_framework_memory_egress_leases;
create policy agent_framework_memory_egress_postgres_all
  on public.agent_framework_memory_egress_leases
  for all to postgres using (true) with check (true);

-- --------------------------------------------------------------------------
-- Service-only content erasure. The old revision/hash is retained only in the
-- content-free audit event; live ciphertext is replaced by an encrypted fixed
-- tombstone before the row enters the deleted state.
-- --------------------------------------------------------------------------

create or replace function public.create_agent_memory(
  p_workspace_id uuid,
  p_owner_id uuid,
  p_spec_id uuid,
  p_actor_id uuid,
  p_kind text,
  p_content_ciphertext text,
  p_content_sha256 text,
  p_content_byte_count integer,
  p_pinned boolean,
  p_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  memory public.agent_memories%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_actor_id is distinct from p_owner_id
     or length(btrim(coalesce(p_kind, ''))) not between 1 and 64
     or p_content_ciphertext is null
     or p_content_ciphertext !~ '^enc:v2:[0-9a-f]{64}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$'
     or p_content_sha256 is null
     or p_content_sha256 !~ '^[0-9a-f]{64}$'
     or p_content_byte_count is null
     or p_content_byte_count not between 1 and 8192
     or (p_expires_at is not null and p_expires_at <= now()) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  perform 1
    from public.profiles as profile
   where profile.workspace_id = p_workspace_id
     and profile.id = p_actor_id
     and profile.role in ('admin', 'member')
   for share;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  perform 1
    from public.agent_specs as spec
   where spec.workspace_id = p_workspace_id
     and spec.owner_id = p_owner_id
     and spec.id = p_spec_id
     and spec.status <> 'archived'
   for share;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  insert into public.agent_memories (
    workspace_id, owner_id, spec_id, kind, content_ciphertext,
    content_sha256, content_byte_count, status, source_type, pinned,
    expires_at, created_by, updated_by
  ) values (
    p_workspace_id, p_owner_id, p_spec_id, btrim(p_kind),
    p_content_ciphertext, p_content_sha256, p_content_byte_count,
    'pending_review', 'operator', coalesce(p_pinned, false), p_expires_at,
    p_actor_id, p_actor_id
  ) returning * into memory;

  insert into public.agent_memory_events (
    memory_id, workspace_id, owner_id, spec_id, actor_id, event_type,
    memory_revision, content_sha256, metadata
  ) values (
    memory.id, memory.workspace_id, memory.owner_id, memory.spec_id,
    p_actor_id, 'created', memory.revision, memory.content_sha256, '{}'::jsonb
  );

  return jsonb_build_object(
    'status', 'created', 'id', memory.id, 'revision', memory.revision,
    'memory_status', memory.status
  );
end;
$$;

revoke all on function public.create_agent_memory(
  uuid, uuid, uuid, uuid, text, text, text, integer, boolean, timestamptz
) from public, anon, authenticated, authenticator;
grant execute on function public.create_agent_memory(
  uuid, uuid, uuid, uuid, text, text, text, integer, boolean, timestamptz
) to service_role;

create or replace function public.mutate_agent_memory(
  p_workspace_id uuid,
  p_owner_id uuid,
  p_spec_id uuid,
  p_memory_id uuid,
  p_actor_id uuid,
  p_expected_revision integer,
  p_operation text,
  p_kind text,
  p_content_ciphertext text,
  p_content_sha256 text,
  p_content_byte_count integer,
  p_pinned boolean,
  p_set_expires boolean,
  p_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  memory public.agent_memories%rowtype;
  audit_type text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_actor_id is distinct from p_owner_id
     or p_expected_revision is null or p_expected_revision < 1
     or p_operation is null
     or p_operation not in ('edit', 'approve', 'reject')
     or (p_kind is not null and length(btrim(p_kind)) not between 1 and 64)
     or ((p_content_ciphertext is null) <> (p_content_sha256 is null))
     or ((p_content_ciphertext is null) <> (p_content_byte_count is null))
     or (p_content_ciphertext is not null and p_content_ciphertext !~ '^enc:v2:[0-9a-f]{64}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$')
     or (p_content_sha256 is not null and p_content_sha256 !~ '^[0-9a-f]{64}$')
     or (p_content_byte_count is not null and p_content_byte_count not between 1 and 8192)
     or (coalesce(p_set_expires, false) and p_expires_at is not null and p_expires_at <= now()) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  perform 1
    from public.profiles as profile
   where profile.workspace_id = p_workspace_id
     and profile.id = p_actor_id
     and profile.role in ('admin', 'member')
   for share;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  select * into memory
    from public.agent_memories
   where workspace_id = p_workspace_id
     and owner_id = p_owner_id
     and spec_id = p_spec_id
     and id = p_memory_id
   for update;
  if not found or memory.status = 'deleted' then
    return jsonb_build_object('status', 'not_found');
  end if;
  if memory.revision is distinct from p_expected_revision then
    return jsonb_build_object('status', 'revision_conflict', 'revision', memory.revision);
  end if;
  if exists (
    select 1
      from public.agent_framework_run_memory_context as context
      join public.agent_framework_memory_egress_leases as egress
        on egress.framework_run_id = context.framework_run_id
     where context.memory_id = memory.id
       and context.workspace_id = memory.workspace_id
       and context.owner_id = memory.owner_id
       and context.spec_id = memory.spec_id
       and egress.released_at is null
       and egress.expires_at > clock_timestamp()
  ) then
    return jsonb_build_object('status', 'memory_in_use', 'revision', memory.revision);
  end if;

  if p_operation = 'edit' then
    if p_kind is null and p_content_ciphertext is null and p_pinned is null
       and not coalesce(p_set_expires, false) then
      return jsonb_build_object('status', 'invalid_request');
    end if;
    update public.agent_memories
       set kind = coalesce(btrim(p_kind), kind),
           content_ciphertext = coalesce(p_content_ciphertext, content_ciphertext),
           content_sha256 = coalesce(p_content_sha256, content_sha256),
           content_byte_count = coalesce(p_content_byte_count, content_byte_count),
           pinned = coalesce(p_pinned, pinned),
           expires_at = case when coalesce(p_set_expires, false)
                             then p_expires_at else expires_at end,
           updated_by = p_actor_id
     where id = memory.id
     returning * into memory;
    audit_type := 'updated';
  else
    if memory.status <> 'pending_review' then
      return jsonb_build_object('status', 'invalid_state', 'memory_status', memory.status);
    end if;
    update public.agent_memories
       set status = case when p_operation = 'approve' then 'approved' else 'rejected' end,
           updated_by = p_actor_id
     where id = memory.id
     returning * into memory;
    audit_type := case when p_operation = 'approve' then 'approved' else 'rejected' end;
  end if;

  insert into public.agent_memory_events (
    memory_id, workspace_id, owner_id, spec_id, actor_id, event_type,
    memory_revision, content_sha256, metadata
  ) values (
    memory.id, memory.workspace_id, memory.owner_id, memory.spec_id,
    p_actor_id, audit_type, memory.revision, memory.content_sha256, '{}'::jsonb
  );

  return jsonb_build_object(
    'status', 'updated', 'id', memory.id, 'revision', memory.revision,
    'memory_status', memory.status
  );
end;
$$;

revoke all on function public.mutate_agent_memory(
  uuid, uuid, uuid, uuid, uuid, integer, text, text, text, text, integer,
  boolean, boolean, timestamptz
) from public, anon, authenticated, authenticator;
grant execute on function public.mutate_agent_memory(
  uuid, uuid, uuid, uuid, uuid, integer, text, text, text, text, integer,
  boolean, boolean, timestamptz
) to service_role;

create or replace function public.delete_agent_memory_content(
  p_workspace_id uuid,
  p_owner_id uuid,
  p_spec_id uuid,
  p_memory_id uuid,
  p_actor_id uuid,
  p_expected_revision integer,
  p_tombstone_ciphertext text,
  p_tombstone_sha256 text,
  p_tombstone_byte_count integer
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  memory public.agent_memories%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_actor_id is distinct from p_owner_id
     or p_expected_revision is null or p_expected_revision < 1
     or p_tombstone_ciphertext is null
     or p_tombstone_ciphertext !~ '^enc:v2:[0-9a-f]{64}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$'
     or p_tombstone_sha256 is null
     or p_tombstone_sha256 !~ '^[0-9a-f]{64}$'
     or p_tombstone_byte_count is null
     or p_tombstone_byte_count not between 1 and 8192 then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  perform 1
    from public.profiles as profile
   where profile.workspace_id = p_workspace_id
     and profile.id = p_actor_id
     and profile.role in ('admin', 'member')
   for share;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  select * into memory
    from public.agent_memories
   where workspace_id = p_workspace_id
     and owner_id = p_owner_id
     and spec_id = p_spec_id
     and id = p_memory_id
   for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if memory.status = 'deleted' then
    return jsonb_build_object('status', 'deleted', 'revision', memory.revision);
  end if;
  if memory.revision is distinct from p_expected_revision then
    return jsonb_build_object('status', 'revision_conflict', 'revision', memory.revision);
  end if;
  if exists (
    select 1
      from public.agent_framework_run_memory_context as context
      join public.agent_framework_memory_egress_leases as egress
        on egress.framework_run_id = context.framework_run_id
     where context.memory_id = memory.id
       and context.workspace_id = memory.workspace_id
       and context.owner_id = memory.owner_id
       and context.spec_id = memory.spec_id
       and egress.released_at is null
       and egress.expires_at > clock_timestamp()
  ) then
    return jsonb_build_object('status', 'memory_in_use', 'revision', memory.revision);
  end if;

  insert into public.agent_memory_events (
    memory_id, workspace_id, owner_id, spec_id, actor_id, event_type,
    memory_revision, content_sha256, metadata
  ) values (
    memory.id, memory.workspace_id, memory.owner_id, memory.spec_id,
    p_actor_id, 'deleted', memory.revision, memory.content_sha256, '{}'::jsonb
  );

  update public.agent_memories
     set content_ciphertext = p_tombstone_ciphertext,
         content_sha256 = p_tombstone_sha256,
         content_byte_count = p_tombstone_byte_count,
         status = 'deleted',
         deleted_at = now(),
         pinned = false,
         expires_at = null,
         updated_by = p_actor_id
   where id = memory.id
   returning * into memory;

  return jsonb_build_object('status', 'deleted', 'revision', memory.revision);
end;
$$;

revoke all on function public.delete_agent_memory_content(
  uuid, uuid, uuid, uuid, uuid, integer, text, text, integer
) from public, anon, authenticated, authenticator;
grant execute on function public.delete_agent_memory_content(
  uuid, uuid, uuid, uuid, uuid, integer, text, text, integer
) to service_role;

-- --------------------------------------------------------------------------
-- Wrap the reviewed 0029 claim implementation. The original function is kept
-- byte-for-byte under a private versioned name. A successful new/reclaimed
-- claim must attach an exact-scope memory snapshot in the same transaction.
-- --------------------------------------------------------------------------

do $claim_agent_framework_run_v0029_preserve$
begin
  if to_regprocedure(
       'public.claim_agent_framework_run(uuid,uuid,uuid,uuid,text,text,uuid,text,text)'
     ) is not null
     and to_regprocedure(
       'public.claim_agent_framework_run_v0029(uuid,uuid,uuid,uuid,text,text,uuid,text,text)'
     ) is null then
    alter function public.claim_agent_framework_run(
      uuid, uuid, uuid, uuid, text, text, uuid, text, text
    ) rename to claim_agent_framework_run_v0029;
  end if;
end
$claim_agent_framework_run_v0029_preserve$;

-- The preserved implementation is private. Leaving its original service-role
-- grant in place would let a caller bypass the receipt-attaching wrapper.
revoke all on function public.claim_agent_framework_run_v0029(
  uuid, uuid, uuid, uuid, text, text, uuid, text, text
) from public, anon, authenticated, authenticator, service_role;

create or replace function public.claim_agent_framework_run(
  p_workspace_id uuid,
  p_owner_id uuid,
  p_actor_id uuid,
  p_spec_id uuid,
  p_campaign_id text,
  p_campaign_fingerprint text,
  p_workflow_version_id uuid,
  p_idempotency_key text,
  p_capability_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  result jsonb;
  claimed_run_id uuid;
  recovered_reports jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  result := public.claim_agent_framework_run_v0029(
    p_workspace_id,
    p_owner_id,
    p_actor_id,
    p_spec_id,
    p_campaign_id,
    p_campaign_fingerprint,
    p_workflow_version_id,
    p_idempotency_key,
    p_capability_sha256
  );

  if result->>'status' = 'claimed' then
    begin
      claimed_run_id := (result->>'run_id')::uuid;
    exception when others then
      raise exception 'invalid framework claim receipt' using errcode = '55000';
    end;
    perform public.attach_agent_framework_run_memory_context(
      p_workspace_id,
      p_owner_id,
      p_spec_id,
      p_actor_id,
      claimed_run_id
    );
  elsif result->>'status' = 'already_completed'
        and result->>'run_status' = 'proposed' then
    begin
      claimed_run_id := (result->>'run_id')::uuid;
    exception when others then
      raise exception 'invalid framework recovery receipt' using errcode = '55000';
    end;
    select proposal_reports into recovered_reports
      from public.agent_framework_runs
     where id = claimed_run_id;
    if recovered_reports is null then
      return jsonb_build_object('status', 'authority_unavailable');
    end if;
    result := result || jsonb_build_object('reports', recovered_reports);
  end if;

  return result;
end;
$$;

revoke all on function public.claim_agent_framework_run(
  uuid, uuid, uuid, uuid, text, text, uuid, text, text
) from public, anon, authenticated, authenticator;
grant execute on function public.claim_agent_framework_run(
  uuid, uuid, uuid, uuid, text, text, uuid, text, text
) to service_role;

-- Persist the bounded public response in the same transaction as the proposal
-- digest. The preserved 0029 function remains the authority for run state,
-- lease, idempotency, query, count, and sourcing-capability checks.
do $complete_agent_framework_run_v0029_preserve$
begin
  if to_regprocedure(
       'public.complete_agent_framework_run(uuid,uuid,text,text,integer,text)'
     ) is not null
     and to_regprocedure(
       'public.complete_agent_framework_run_v0029(uuid,uuid,text,text,integer,text)'
     ) is null then
    alter function public.complete_agent_framework_run(
      uuid, uuid, text, text, integer, text
    ) rename to complete_agent_framework_run_v0029;
  end if;
end
$complete_agent_framework_run_v0029_preserve$;

revoke all on function public.complete_agent_framework_run_v0029(
  uuid, uuid, text, text, integer, text
) from public, anon, authenticated, authenticator, service_role;

drop function if exists public.complete_agent_framework_run(
  uuid, uuid, text, text, integer, text, jsonb
);
create function public.complete_agent_framework_run(
  p_run_id uuid,
  p_lease_id uuid,
  p_proposal_sha256 text,
  p_sourcing_capability_sha256 text,
  p_sourcing_count integer,
  p_source_query text,
  p_reports jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  result jsonb;
  stored_reports jsonb;
  report_summary text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_reports is null or jsonb_typeof(p_reports) is distinct from 'array' then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  if jsonb_array_length(p_reports) <> 1
     or jsonb_typeof(p_reports->0) is distinct from 'string' then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  report_summary := p_reports->>0;
  if report_summary is null
     or char_length(report_summary) not between 1 and 500
     or report_summary is distinct from btrim(report_summary)
     or report_summary ~ '[[:cntrl:]]' then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  result := public.complete_agent_framework_run_v0029(
    p_run_id,
    p_lease_id,
    p_proposal_sha256,
    p_sourcing_capability_sha256,
    p_sourcing_count,
    p_source_query
  );
  if result->>'status' not in ('proposed', 'replay') then
    return result;
  end if;

  select proposal_reports into stored_reports
    from public.agent_framework_runs
   where id = p_run_id
     and status = 'proposed'
     and proposal_sha256 = p_proposal_sha256
   for update;
  if not found then
    raise exception 'framework completion receipt unavailable' using errcode = '55000';
  end if;
  if stored_reports is null then
    update public.agent_framework_runs
       set proposal_reports = p_reports
     where id = p_run_id;
  elsif stored_reports is distinct from p_reports then
    return jsonb_build_object('status', 'idempotency_conflict');
  end if;

  return result;
end;
$$;

revoke all on function public.complete_agent_framework_run(
  uuid, uuid, text, text, integer, text, jsonb
) from public, anon, authenticated, authenticator;
grant execute on function public.complete_agent_framework_run(
  uuid, uuid, text, text, integer, text, jsonb
) to service_role;

create or replace function public.attach_agent_framework_run_memory_context(
  p_workspace_id uuid,
  p_owner_id uuid,
  p_spec_id uuid,
  p_actor_id uuid,
  p_framework_run_id uuid
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  framework_run public.agent_framework_runs%rowtype;
  memory_row public.agent_memories%rowtype;
  selected_count integer := 0;
  total_bytes integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select * into framework_run
    from public.agent_framework_runs
   where id = p_framework_run_id
     and workspace_id = p_workspace_id
     and owner_id = p_owner_id
     and spec_id = p_spec_id
     and actor_id = p_actor_id
   for update;
  if not found then
    raise exception 'exact-scope framework run not found' using errcode = '22023';
  end if;

  -- Replays and expired-lease recoveries preserve the original snapshot,
  -- including an intentionally empty snapshot.
  select count(*)::integer into selected_count
    from public.agent_framework_run_memory_context
   where framework_run_id = p_framework_run_id;
  if framework_run.memory_context_attached_at is not null then return selected_count; end if;

  selected_count := 0;
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

    insert into public.agent_framework_run_memory_context (
      framework_run_id, workspace_id, owner_id, spec_id, memory_id,
      memory_revision, content_sha256, position, byte_count
    ) values (
      framework_run.id, framework_run.workspace_id, framework_run.owner_id,
      framework_run.spec_id, memory_row.id, memory_row.revision,
      memory_row.content_sha256, selected_count, memory_row.content_byte_count
    );

    insert into public.agent_memory_events (
      memory_id, workspace_id, owner_id, spec_id, framework_run_id, actor_id,
      event_type, memory_revision, content_sha256, metadata
    ) values (
      memory_row.id, framework_run.workspace_id, framework_run.owner_id,
      framework_run.spec_id, framework_run.id, framework_run.actor_id,
      'selected', memory_row.revision, memory_row.content_sha256, '{}'::jsonb
    );

    selected_count := selected_count + 1;
    total_bytes := total_bytes + memory_row.content_byte_count;
  end loop;

  update public.agent_framework_runs
     set memory_context_attached_at = now()
   where id = framework_run.id;

  return selected_count;
end;
$$;

revoke all on function public.attach_agent_framework_run_memory_context(
  uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated, authenticator;
grant execute on function public.attach_agent_framework_run_memory_context(
  uuid, uuid, uuid, uuid, uuid
) to service_role;

create or replace function public.authorize_agent_framework_memory_egress(
  p_framework_run_id uuid,
  p_run_lease_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  framework_run public.agent_framework_runs%rowtype;
  prior_egress public.agent_framework_memory_egress_leases%rowtype;
  egress_id uuid := gen_random_uuid();
  egress_expires_at timestamptz := clock_timestamp() + interval '75 seconds';
  receipt_count integer := 0;
  valid_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_framework_run_id is null or p_run_lease_id is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select * into framework_run
    from public.agent_framework_runs
   where id = p_framework_run_id
   for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if framework_run.lease_id is distinct from p_run_lease_id
     or framework_run.status not in ('claimed', 'running')
     or framework_run.lease_expires_at <= egress_expires_at
     or framework_run.memory_context_attached_at is null then
    return jsonb_build_object('status', 'lease_invalid');
  end if;

  select * into prior_egress
    from public.agent_framework_memory_egress_leases
   where framework_run_id = framework_run.id
     and run_lease_id = p_run_lease_id
   for update;
  if found then
    -- Egress is deliberately one-shot. Replaying a near-expiry authorization
    -- could start a new adapter request after memory mutation is allowed again.
    return jsonb_build_object('status', 'lease_invalid');
  end if;

  -- Serialize against every edit/delete RPC, which locks the same memory row
  -- before consulting the active egress table.
  perform memory.id
    from public.agent_memories as memory
    join public.agent_framework_run_memory_context as context
      on context.workspace_id = memory.workspace_id
     and context.owner_id = memory.owner_id
     and context.spec_id = memory.spec_id
     and context.memory_id = memory.id
   where context.framework_run_id = framework_run.id
   order by memory.id
   for update of memory;

  select count(*)::integer into receipt_count
    from public.agent_framework_run_memory_context
   where framework_run_id = framework_run.id;
  select count(*)::integer into valid_count
    from public.agent_framework_run_memory_context as context
    join public.agent_memories as memory
      on memory.workspace_id = context.workspace_id
     and memory.owner_id = context.owner_id
     and memory.spec_id = context.spec_id
     and memory.id = context.memory_id
   where context.framework_run_id = framework_run.id
     and context.workspace_id = framework_run.workspace_id
     and context.owner_id = framework_run.owner_id
     and context.spec_id = framework_run.spec_id
     and memory.revision = context.memory_revision
     and memory.content_sha256 = context.content_sha256
     and memory.content_byte_count = context.byte_count
     and memory.status = 'approved'
     and memory.deleted_at is null
     and (memory.expires_at is null or memory.expires_at > egress_expires_at);
  if valid_count is distinct from receipt_count then
    return jsonb_build_object('status', 'memory_changed');
  end if;

  insert into public.agent_framework_memory_egress_leases (
    id, framework_run_id, run_lease_id, workspace_id, owner_id, spec_id,
    expires_at
  ) values (
    egress_id, framework_run.id, p_run_lease_id, framework_run.workspace_id,
    framework_run.owner_id, framework_run.spec_id, egress_expires_at
  );

  return jsonb_build_object(
    'status', 'authorized',
    'egress_lease_id', egress_id,
    'expires_at', egress_expires_at,
    'replayed', false
  );
end;
$$;

revoke all on function public.authorize_agent_framework_memory_egress(uuid, uuid)
  from public, anon, authenticated, authenticator;
grant execute on function public.authorize_agent_framework_memory_egress(uuid, uuid)
  to service_role;

create or replace function public.release_agent_framework_memory_egress(
  p_framework_run_id uuid,
  p_run_lease_id uuid,
  p_egress_lease_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  egress public.agent_framework_memory_egress_leases%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_framework_run_id is null or p_run_lease_id is null or p_egress_lease_id is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select * into egress
    from public.agent_framework_memory_egress_leases
   where id = p_egress_lease_id
     and framework_run_id = p_framework_run_id
     and run_lease_id = p_run_lease_id
   for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  if egress.released_at is not null then
    return jsonb_build_object('status', 'released');
  end if;
  if egress.expires_at <= clock_timestamp() then
    return jsonb_build_object('status', 'lease_expired');
  end if;

  update public.agent_framework_memory_egress_leases
     set released_at = clock_timestamp()
   where id = egress.id;
  return jsonb_build_object('status', 'released');
end;
$$;

revoke all on function public.release_agent_framework_memory_egress(uuid, uuid, uuid)
  from public, anon, authenticated, authenticator;
grant execute on function public.release_agent_framework_memory_egress(uuid, uuid, uuid)
  to service_role;

-- Memory writes must pass through the security-definer RPCs above so revision
-- checks, tombstoning, and their content-free audit event commit atomically.
-- The service role keeps read access for exact-scope runtime decryption.
revoke insert, update, delete on public.agent_memories from service_role;
revoke insert on public.agent_run_memory_context from service_role;
revoke insert on public.agent_memory_events from service_role;
revoke usage on sequence public.agent_memory_events_id_seq from service_role;
