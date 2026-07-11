-- ============================================================================
-- ARIA authority boundaries: normalized integration configuration
--
-- Databricks execution authority must never come from workspace_state. Members
-- legitimately write that shared application document, so it cannot own an
-- outbound origin, credential binding, OAuth identity, warehouse, or SQL text.
-- This migration creates one admin-owned Databricks connection per workspace,
-- enforces the credential binding in PostgreSQL, and records every config change.
-- ============================================================================

-- A composite target lets a connection bind one key to the same workspace and
-- exact provider in a single foreign-key constraint. The api_keys primary key is
-- still the canonical row identity.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'api_keys_id_workspace_provider_key'
       and conrelid = 'public.api_keys'::regclass
  ) then
    alter table public.api_keys
      add constraint api_keys_id_workspace_provider_key
      unique (id, workspace_id, provider);
  end if;
end
$$;

create table if not exists public.databricks_connections (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null unique references public.workspaces(id) on delete cascade,
  purpose             text not null default 'hiring_needs',
  origin              text not null,
  warehouse_id        text not null,
  auth_mode           text not null,
  client_id           text,
  api_key_id          uuid not null,
  credential_provider text not null default 'Databricks',
  needs_query         text not null,
  enabled             boolean not null default true,
  config_revision     bigint not null default 1,
  created_by          uuid references auth.users(id) on delete set null,
  updated_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint databricks_connections_purpose_check
    check (purpose = 'hiring_needs'),
  constraint databricks_connections_provider_check
    check (credential_provider = 'Databricks'),
  constraint databricks_connections_auth_mode_check
    check (auth_mode in ('pat', 'm2m')),
  constraint databricks_connections_client_id_check
    check (
      (auth_mode = 'pat' and nullif(btrim(client_id), '') is null)
      or
      (auth_mode = 'm2m' and nullif(btrim(client_id), '') is not null)
    ),
  constraint databricks_connections_origin_check
    check (length(btrim(origin)) between 1 and 2048),
  constraint databricks_connections_warehouse_check
    check (length(btrim(warehouse_id)) between 1 and 256),
  constraint databricks_connections_query_check
    check (length(needs_query) between 1 and 20000 and strpos(needs_query, ':since') > 0),
  constraint databricks_connections_revision_check
    check (config_revision > 0),
  constraint databricks_connections_key_binding_fkey
    foreign key (api_key_id, workspace_id, credential_provider)
    references public.api_keys(id, workspace_id, provider)
    on delete restrict
);

-- Append-only, non-secret evidence. The hash proves which canonical config was
-- active without copying credentials or SQL text into the audit surface.
create table if not exists public.databricks_connection_events (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  connection_id   uuid not null,
  actor_id         uuid references auth.users(id) on delete set null,
  action           text not null check (action in ('insert', 'update', 'delete')),
  config_revision  bigint not null,
  config_hash      text not null check (config_hash ~ '^[0-9a-f]{64}$'),
  created_at       timestamptz not null default now()
);

create index if not exists databricks_connection_events_authority_idx
  on public.databricks_connection_events (workspace_id, connection_id, created_at desc);

alter table public.databricks_connections enable row level security;
alter table public.databricks_connections force row level security;
alter table public.databricks_connection_events enable row level security;
alter table public.databricks_connection_events force row level security;

revoke all on public.databricks_connections
  from public, anon, authenticated, service_role, authenticator;
revoke all on public.databricks_connection_events
  from public, anon, authenticated, service_role, authenticator;

grant select, insert, update, delete on public.databricks_connections to authenticated;
grant select on public.databricks_connection_events to authenticated;
grant select on public.databricks_connections to service_role;

drop policy if exists "admins read Databricks connections" on public.databricks_connections;
create policy "admins read Databricks connections"
  on public.databricks_connections for select
  using (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  );

drop policy if exists "admins insert Databricks connections" on public.databricks_connections;
create policy "admins insert Databricks connections"
  on public.databricks_connections for insert
  with check (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  );

drop policy if exists "admins update Databricks connections" on public.databricks_connections;
create policy "admins update Databricks connections"
  on public.databricks_connections for update
  using (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  )
  with check (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  );

drop policy if exists "admins delete Databricks connections" on public.databricks_connections;
create policy "admins delete Databricks connections"
  on public.databricks_connections for delete
  using (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  );

drop policy if exists "admins read Databricks connection events" on public.databricks_connection_events;
create policy "admins read Databricks connection events"
  on public.databricks_connection_events for select
  using (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  );

-- The audit trigger is SECURITY DEFINER and owned by the direct migration
-- role. The event table FORCEs RLS, so the now-NOBYPASSRLS migrator needs one
-- narrow INSERT policy for this trigger path, not cluster-wide RLS bypass.
drop policy if exists "Databricks audit trigger inserts events"
  on public.databricks_connection_events;
create policy "Databricks audit trigger inserts events"
  on public.databricks_connection_events for insert to postgres
  with check (true);

create or replace function public.stamp_databricks_connection_authority()
returns trigger
language plpgsql
set search_path = public, pg_temp
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
    new.purpose := old.purpose;
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

revoke all on function public.stamp_databricks_connection_authority() from public, anon, authenticated;

drop trigger if exists databricks_connections_stamp_authority on public.databricks_connections;
create trigger databricks_connections_stamp_authority
  before insert or update on public.databricks_connections
  for each row execute function public.stamp_databricks_connection_authority();

create or replace function public.audit_databricks_connection_authority()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  authority public.databricks_connections%rowtype;
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
        authority.purpose,
        authority.origin,
        authority.warehouse_id,
        authority.auth_mode,
        coalesce(authority.client_id, ''),
        authority.api_key_id::text,
        authority.credential_provider,
        authority.needs_query,
        authority.enabled::text,
        authority.config_revision::text
      )::text,
      'sha256'
    ),
    'hex'
  );

  insert into public.databricks_connection_events (
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

revoke all on function public.audit_databricks_connection_authority() from public, anon, authenticated;

drop trigger if exists databricks_connections_audit_authority on public.databricks_connections;
create trigger databricks_connections_audit_authority
  after insert or update or delete on public.databricks_connections
  for each row execute function public.audit_databricks_connection_authority();

-- Old clients may still submit the full shared state. Strip the obsolete field
-- in the database so those writes preserve unrelated state without recreating a
-- misleading member-controlled integration record.
create or replace function public.strip_legacy_databricks_authority()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if jsonb_typeof(new.state -> 'settings') = 'object'
     and (new.state -> 'settings') ? 'databricks' then
    new.state := jsonb_set(
      new.state,
      '{settings}',
      (new.state -> 'settings') - 'databricks',
      false
    );
  end if;
  return new;
end;
$$;

revoke all on function public.strip_legacy_databricks_authority() from public, anon, authenticated;

drop trigger if exists workspace_state_strip_databricks_authority on public.workspace_state;
create trigger workspace_state_strip_databricks_authority
  before insert or update on public.workspace_state
  for each row execute function public.strip_legacy_databricks_authority();

-- Clean the current documents through the same trigger. There is intentionally
-- no automatic backfill: the legacy field has no trustworthy writer provenance.
update public.workspace_state
   set state = state
 where jsonb_typeof(state -> 'settings') = 'object'
   and (state -> 'settings') ? 'databricks';

-- ================= END DATABRICKS AUTHORITY SECTION =========================
-- Root may append the independently reviewed database privilege allowlist below.

-- ==========================================================================
-- Canonical function privileges
--
-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Revoking
-- only `authenticated` does not override that inherited grant. Reset the full
-- application routine surface, then grant only the reviewed entry points.
-- ==========================================================================

do $aria_function_acl$
declare
  routine text;
begin
  -- Reset defaults for the postgres migration owner so every later migration
  -- must grant its reviewed surface explicitly. The bootstrap performs the
  -- equivalent reconciliation through a direct supabase_admin session because
  -- PostgreSQL does not permit postgres to mutate another owner's defaults.
  execute 'alter default privileges revoke all on tables from public';
  execute 'alter default privileges revoke all on sequences from public';
  execute 'alter default privileges revoke execute on functions from public';
  execute 'alter default privileges in schema public revoke all on tables from anon, authenticated, service_role, authenticator';
  execute 'alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role, authenticator';
  execute 'alter default privileges in schema public revoke execute on functions from anon, authenticated, service_role, authenticator';
  execute
    'revoke create on schema public from public, anon, authenticated, service_role, authenticator';
  if to_regnamespace('extensions') is not null then
    execute
      'revoke create on schema extensions from public, anon, authenticated, service_role, authenticator';
  end if;

  -- Reset every current application routine, including trigger-only helpers.
  foreach routine in array array[
    'public.current_workspace_id()',
    'public.current_profile_role()',
    'public.ensure_workspace()',
    'public.touch_updated_at()',
    'public.claim_and_record(text,text,text,uuid,text,integer)',
    'public.normalize_whatsapp_e164(text)',
    'public.claim_whatsapp_outbound(uuid)',
    'public.record_whatsapp_provider_acceptance(uuid,uuid,text)',
    'public.record_whatsapp_delivery_event(uuid,uuid,text,text,timestamptz,integer)',
    'public.record_outreach_approval(text,text,text)',
    'public.revoke_outreach_approval(text,text)',
    'public.claim_email_outbound(text,text,text,text,text,text,uuid)',
    'public.enforce_active_whatsapp_approval()',
    'public.review_whatsapp_outbound(uuid,text)',
    'public.claim_whatsapp_inbound_processing(uuid,uuid)',
    'public.complete_whatsapp_inbound_processing(uuid,uuid,text,text)',
    'public.finalize_whatsapp_provider_failure(uuid,uuid,text)',
    'public.stamp_databricks_connection_authority()',
    'public.audit_databricks_connection_authority()',
    'public.strip_legacy_databricks_authority()'
  ]
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role, authenticator',
      routine
    );
  end loop;

  -- AUTHENTICATED RPC ALLOWLIST
  foreach routine in array array[
    'public.current_workspace_id()',
    'public.current_profile_role()',
    'public.ensure_workspace()',
    'public.record_outreach_approval(text,text,text)',
    'public.revoke_outreach_approval(text,text)',
    'public.claim_email_outbound(text,text,text,text,text,text,uuid)',
    'public.review_whatsapp_outbound(uuid,text)'
  ]
  loop
    execute format('grant execute on function %s to authenticated', routine);
  end loop;

  -- SERVICE RPC ALLOWLIST
  -- claim_and_record intentionally has no auth.role() assertion because the
  -- authenticated claim_email_outbound SECURITY DEFINER wrapper invokes it as
  -- the function owner. Direct callers remain service_role-only by this ACL.
  foreach routine in array array[
    'public.claim_and_record(text,text,text,uuid,text,integer)',
    'public.claim_whatsapp_outbound(uuid)',
    'public.record_whatsapp_provider_acceptance(uuid,uuid,text)',
    'public.record_whatsapp_delivery_event(uuid,uuid,text,text,timestamptz,integer)',
    'public.claim_whatsapp_inbound_processing(uuid,uuid)',
    'public.complete_whatsapp_inbound_processing(uuid,uuid,text,text)',
    'public.finalize_whatsapp_provider_failure(uuid,uuid,text)'
  ]
  loop
    execute format('grant execute on function %s to service_role', routine);
  end loop;

  -- Trusted schemas first and the temporary schema last for every routine.
  foreach routine in array array[
    'public.current_workspace_id()',
    'public.current_profile_role()',
    'public.ensure_workspace()',
    'public.touch_updated_at()',
    'public.claim_and_record(text,text,text,uuid,text,integer)',
    'public.normalize_whatsapp_e164(text)',
    'public.record_whatsapp_provider_acceptance(uuid,uuid,text)',
    'public.record_whatsapp_delivery_event(uuid,uuid,text,text,timestamptz,integer)',
    'public.record_outreach_approval(text,text,text)',
    'public.revoke_outreach_approval(text,text)',
    'public.claim_email_outbound(text,text,text,text,text,text,uuid)',
    'public.claim_whatsapp_inbound_processing(uuid,uuid)',
    'public.complete_whatsapp_inbound_processing(uuid,uuid,text,text)',
    'public.finalize_whatsapp_provider_failure(uuid,uuid,text)',
    'public.stamp_databricks_connection_authority()',
    'public.strip_legacy_databricks_authority()'
  ]
  loop
    execute format(
      'alter function %s set search_path = pg_catalog, public, pg_temp',
      routine
    );
  end loop;

  foreach routine in array array[
    'public.claim_whatsapp_outbound(uuid)',
    'public.enforce_active_whatsapp_approval()',
    'public.review_whatsapp_outbound(uuid,text)',
    'public.audit_databricks_connection_authority()'
  ]
  loop
    execute format(
      'alter function %s set search_path = pg_catalog, public, extensions, pg_temp',
      routine
    );
  end loop;
end
$aria_function_acl$;
