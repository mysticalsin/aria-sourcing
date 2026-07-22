-- 0056_need_ingress_credential_authority.sql
--
-- Tenant-bound authority for external need ingress. Clients retain a strong
-- opaque key and present it as the HMAC key. The database stores only its
-- SHA-256 digest. Workspace identity is resolved from that digest and is
-- revalidated under a row lock inside the ingest transaction.

set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';

create table if not exists public.need_ingress_credentials (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces(id) on update restrict on delete restrict,
  key_sha256 text not null,
  label text not null,
  status text not null default 'active',
  expires_at timestamptz not null,
  created_by uuid not null
    references public.profiles(id) on update restrict on delete restrict,
  created_at timestamptz not null default now(),
  revoked_by uuid
    references public.profiles(id) on update restrict on delete restrict,
  revoked_at timestamptz,

  constraint need_ingress_credentials_key_sha256_check
    check (key_sha256 ~ '^[0-9a-f]{64}$'),
  constraint need_ingress_credentials_label_check check (
    label = btrim(label)
    and octet_length(label) between 1 and 100
    and label !~ '[[:cntrl:]]'
  ),
  constraint need_ingress_credentials_status_check
    check (status in ('active', 'revoked')),
  constraint need_ingress_credentials_expiry_check
    check (expires_at > created_at),
  constraint need_ingress_credentials_lifecycle_check check (
    (
      status = 'active'
      and revoked_by is null
      and revoked_at is null
    )
    or (
      status = 'revoked'
      and revoked_by is not null
      and revoked_at is not null
      and revoked_at >= created_at
    )
  ),
  constraint need_ingress_credentials_key_sha256_key unique (key_sha256),
  constraint need_ingress_credentials_id_workspace_key unique (id, workspace_id)
);

create index if not exists need_ingress_credentials_workspace_lifecycle_idx
  on public.need_ingress_credentials(workspace_id, status, expires_at);

create table if not exists public.need_ingress_credential_receipts (
  id uuid primary key,
  workspace_id uuid not null,
  credential_id uuid not null,
  request_id uuid not null,
  event_type text not null,
  actor_id uuid not null
    references public.profiles(id) on update restrict on delete restrict,
  label text not null,
  expires_at timestamptz not null,
  key_sha256 text not null,
  request_sha256 text not null,
  receipt_sha256 text not null,
  created_at timestamptz not null default now(),

  constraint need_ingress_credential_receipts_event_type_check
    check (event_type in ('created', 'revoked')),
  constraint need_ingress_credential_receipts_label_check check (
    label = btrim(label)
    and octet_length(label) between 1 and 100
    and label !~ '[[:cntrl:]]'
  ),
  constraint need_ingress_credential_receipts_key_sha256_check
    check (key_sha256 ~ '^[0-9a-f]{64}$'),
  constraint need_ingress_credential_receipts_request_sha256_check
    check (request_sha256 ~ '^[0-9a-f]{64}$'),
  constraint need_ingress_credential_receipts_receipt_sha256_check check (
    receipt_sha256 ~ '^[0-9a-f]{64}$'
    and receipt_sha256 = encode(sha256(convert_to(concat_ws(E'\n',
      'aria.need-ingress-credential-receipt.v1',
      id::text,
      workspace_id::text,
      credential_id::text,
      request_id::text,
      event_type,
      actor_id::text,
      label,
      ((extract(epoch from expires_at) * 1000000)::bigint)::text,
      key_sha256,
      request_sha256
    ), 'UTF8')), 'hex')
  ),
  constraint need_ingress_credential_receipts_request_key
    unique (workspace_id, request_id),
  constraint need_ingress_credential_receipts_credential_workspace_fkey
    foreign key (credential_id, workspace_id)
    references public.need_ingress_credentials(id, workspace_id)
    on update restrict on delete restrict
);

create index if not exists need_ingress_credential_receipts_credential_created_idx
  on public.need_ingress_credential_receipts(credential_id, created_at);

alter table public.need_ingress_credentials enable row level security;
alter table public.need_ingress_credentials force row level security;
alter table public.need_ingress_credential_receipts enable row level security;
alter table public.need_ingress_credential_receipts force row level security;

revoke all on public.need_ingress_credentials
  from public, anon, authenticated, service_role, authenticator;
revoke all on public.need_ingress_credential_receipts
  from public, anon, authenticated, service_role, authenticator;

drop policy if exists need_ingress_credentials_owner_access
  on public.need_ingress_credentials;
create policy need_ingress_credentials_owner_access
  on public.need_ingress_credentials
  for all to postgres, supabase_admin using (true) with check (true);

drop policy if exists need_ingress_credential_receipts_owner_access
  on public.need_ingress_credential_receipts;
create policy need_ingress_credential_receipts_owner_access
  on public.need_ingress_credential_receipts
  for all to postgres, supabase_admin using (true) with check (true);

create or replace function public.enforce_need_ingress_credential_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if current_setting('aria.need_ingress_credential_mutation_authorized', true)
       is distinct from '0056' then
    raise exception 'need ingress credential mutation requires its authority function'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    raise exception 'need ingress credentials are immutable evidence'
      using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    return new;
  end if;

  if old.id is distinct from new.id
     or old.workspace_id is distinct from new.workspace_id
     or old.key_sha256 is distinct from new.key_sha256
     or old.label is distinct from new.label
     or old.expires_at is distinct from new.expires_at
     or old.created_by is distinct from new.created_by
     or old.created_at is distinct from new.created_at
     or old.status <> 'active'
     or new.status <> 'revoked'
     or new.revoked_by is null
     or new.revoked_at is null then
    raise exception 'invalid need ingress credential lifecycle transition'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_need_ingress_credential_receipt_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op <> 'INSERT'
     or current_setting('aria.need_ingress_receipt_mutation_authorized', true)
          is distinct from '0056' then
    raise exception 'need ingress credential receipts are append-only'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

alter function public.enforce_need_ingress_credential_mutation() owner to postgres;
alter function public.enforce_need_ingress_credential_receipt_mutation() owner to postgres;
revoke all on function public.enforce_need_ingress_credential_mutation()
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.enforce_need_ingress_credential_receipt_mutation()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists need_ingress_credentials_enforce_mutation
  on public.need_ingress_credentials;
create trigger need_ingress_credentials_enforce_mutation
  before insert or update or delete on public.need_ingress_credentials
  for each row execute function public.enforce_need_ingress_credential_mutation();

drop trigger if exists need_ingress_credential_receipts_enforce_mutation
  on public.need_ingress_credential_receipts;
create trigger need_ingress_credential_receipts_enforce_mutation
  before insert or update or delete on public.need_ingress_credential_receipts
  for each row execute function public.enforce_need_ingress_credential_receipt_mutation();

drop function if exists public.create_need_ingress_credential(text, text, timestamptz, uuid);
drop function if exists public.revoke_need_ingress_credential(uuid, uuid);

create or replace function public.create_need_ingress_credential(
  p_label text,
  p_key_sha256 text,
  p_expires_at timestamptz,
  p_request_id uuid,
  p_expected_workspace_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  caller_workspace uuid;
  caller_id uuid := auth.uid();
  existing_receipt public.need_ingress_credential_receipts%rowtype;
  credential_id uuid := gen_random_uuid();
  receipt_id uuid := gen_random_uuid();
  request_hash text;
  receipt_hash text;
begin
  if coalesce(auth.role(), '') <> 'authenticated' or caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  caller_workspace := public.current_workspace_id();
  if caller_workspace is null then
    raise exception 'workspace required' using errcode = '42501';
  end if;
  if p_expected_workspace_id is null
     or caller_workspace is distinct from p_expected_workspace_id then
    return jsonb_build_object('status', 'workspace_conflict');
  end if;
  perform 1
    from public.profiles profile
   where profile.id = caller_id
     and profile.workspace_id = caller_workspace
     and profile.role = 'admin'
   for key share;
  if not found then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;

  if p_label is null
     or p_label <> btrim(p_label)
     or octet_length(p_label) not between 1 and 100
     or p_label ~ '[[:cntrl:]]'
     or p_key_sha256 is null
     or p_key_sha256 !~ '^[0-9a-f]{64}$'
     or p_expires_at is null
     or p_expires_at <= clock_timestamp()
     or p_expires_at > clock_timestamp() + interval '90 days'
     or p_request_id is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  perform pg_advisory_xact_lock_shared(560056202607210056::bigint);
  perform pg_advisory_xact_lock(hashtextextended(
    'aria.need-ingress-workspace.v1' || E'\n' || caller_workspace::text,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'aria.need-ingress-create.v1' || E'\n' || caller_workspace::text || E'\n' || p_request_id::text,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'aria.need-ingress-key.v1' || E'\n' || p_key_sha256,
    0
  ));

  request_hash := encode(sha256(convert_to(concat_ws(E'\n',
    'aria.need-ingress-create-request.v1',
    caller_workspace::text,
    caller_id::text,
    p_label,
    p_key_sha256,
    ((extract(epoch from p_expires_at) * 1000000)::bigint)::text
  ), 'UTF8')), 'hex');

  select * into existing_receipt
    from public.need_ingress_credential_receipts receipt
   where receipt.workspace_id = caller_workspace
     and receipt.request_id = p_request_id
   for share;
  if found then
    if existing_receipt.event_type <> 'created'
       or existing_receipt.request_sha256 is distinct from request_hash then
      return jsonb_build_object('status', 'idempotency_conflict');
    end if;
    return jsonb_build_object(
      'status', 'created',
      'replay', true,
      'credential_id', existing_receipt.credential_id,
      'workspace_id', existing_receipt.workspace_id,
      'label', existing_receipt.label,
      'expires_at', existing_receipt.expires_at,
      'receipt_sha256', existing_receipt.receipt_sha256
    );
  end if;

  if (
    select count(*)
      from public.need_ingress_credentials credential
     where credential.workspace_id = caller_workspace
       and credential.status = 'active'
       and credential.revoked_at is null
       and credential.expires_at > clock_timestamp()
  ) >= 100 then
    return jsonb_build_object('status', 'active_limit_reached');
  end if;

  if exists (
    select 1
      from public.need_ingress_credentials credential
     where credential.key_sha256 = p_key_sha256
  ) then
    return jsonb_build_object('status', 'key_conflict');
  end if;

  perform set_config('aria.need_ingress_credential_mutation_authorized', '0056', true);
  insert into public.need_ingress_credentials (
    id, workspace_id, key_sha256, label, expires_at, created_by
  ) values (
    credential_id, caller_workspace, p_key_sha256, p_label, p_expires_at, caller_id
  );

  receipt_hash := encode(sha256(convert_to(concat_ws(E'\n',
    'aria.need-ingress-credential-receipt.v1',
    receipt_id::text,
    caller_workspace::text,
    credential_id::text,
    p_request_id::text,
    'created',
    caller_id::text,
    p_label,
    ((extract(epoch from p_expires_at) * 1000000)::bigint)::text,
    p_key_sha256,
    request_hash
  ), 'UTF8')), 'hex');
  perform set_config('aria.need_ingress_receipt_mutation_authorized', '0056', true);
  insert into public.need_ingress_credential_receipts (
    id, workspace_id, credential_id, request_id, event_type, actor_id,
    label, expires_at, key_sha256, request_sha256, receipt_sha256
  ) values (
    receipt_id, caller_workspace, credential_id, p_request_id, 'created', caller_id,
    p_label, p_expires_at, p_key_sha256, request_hash, receipt_hash
  );

  return jsonb_build_object(
    'status', 'created',
    'replay', false,
    'credential_id', credential_id,
    'workspace_id', caller_workspace,
    'label', p_label,
    'expires_at', p_expires_at,
    'receipt_sha256', receipt_hash
  );
end;
$$;

create or replace function public.revoke_need_ingress_credential(
  p_credential_id uuid,
  p_request_id uuid,
  p_expected_workspace_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  caller_workspace uuid;
  caller_id uuid := auth.uid();
  credential_row public.need_ingress_credentials%rowtype;
  existing_receipt public.need_ingress_credential_receipts%rowtype;
  receipt_id uuid := gen_random_uuid();
  request_hash text;
  receipt_hash text;
  revoke_timestamp timestamptz := clock_timestamp();
begin
  if coalesce(auth.role(), '') <> 'authenticated' or caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  caller_workspace := public.current_workspace_id();
  if caller_workspace is null then
    raise exception 'workspace required' using errcode = '42501';
  end if;
  if p_expected_workspace_id is null
     or caller_workspace is distinct from p_expected_workspace_id then
    return jsonb_build_object('status', 'workspace_conflict');
  end if;
  perform 1
    from public.profiles profile
   where profile.id = caller_id
     and profile.workspace_id = caller_workspace
     and profile.role = 'admin'
   for key share;
  if not found then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;
  if p_credential_id is null or p_request_id is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  perform pg_advisory_xact_lock_shared(560056202607210056::bigint);
  perform pg_advisory_xact_lock(hashtextextended(
    'aria.need-ingress-workspace.v1' || E'\n' || caller_workspace::text,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'aria.need-ingress-revoke.v1' || E'\n' || caller_workspace::text || E'\n' || p_request_id::text,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'aria.need-ingress-credential.v1' || E'\n' || p_credential_id::text,
    0
  ));

  request_hash := encode(sha256(convert_to(concat_ws(E'\n',
    'aria.need-ingress-revoke-request.v1',
    caller_workspace::text,
    caller_id::text,
    p_credential_id::text
  ), 'UTF8')), 'hex');

  select * into existing_receipt
    from public.need_ingress_credential_receipts receipt
   where receipt.workspace_id = caller_workspace
     and receipt.request_id = p_request_id
   for share;
  if found then
    if existing_receipt.event_type <> 'revoked'
       or existing_receipt.credential_id <> p_credential_id
       or existing_receipt.request_sha256 is distinct from request_hash then
      return jsonb_build_object('status', 'idempotency_conflict');
    end if;
    return jsonb_build_object(
      'status', 'revoked',
      'replay', true,
      'credential_id', existing_receipt.credential_id,
      'workspace_id', existing_receipt.workspace_id,
      'receipt_sha256', existing_receipt.receipt_sha256
    );
  end if;

  select * into credential_row
    from public.need_ingress_credentials credential
   where credential.id = p_credential_id
     and credential.workspace_id = caller_workspace
   for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if credential_row.status = 'revoked' then
    return jsonb_build_object('status', 'already_revoked');
  end if;

  perform set_config('aria.need_ingress_credential_mutation_authorized', '0056', true);
  update public.need_ingress_credentials
     set status = 'revoked',
         revoked_by = caller_id,
         revoked_at = revoke_timestamp
   where id = credential_row.id;

  receipt_hash := encode(sha256(convert_to(concat_ws(E'\n',
    'aria.need-ingress-credential-receipt.v1',
    receipt_id::text,
    caller_workspace::text,
    credential_row.id::text,
    p_request_id::text,
    'revoked',
    caller_id::text,
    credential_row.label,
    ((extract(epoch from credential_row.expires_at) * 1000000)::bigint)::text,
    credential_row.key_sha256,
    request_hash
  ), 'UTF8')), 'hex');
  perform set_config('aria.need_ingress_receipt_mutation_authorized', '0056', true);
  insert into public.need_ingress_credential_receipts (
    id, workspace_id, credential_id, request_id, event_type, actor_id,
    label, expires_at, key_sha256, request_sha256, receipt_sha256
  ) values (
    receipt_id, caller_workspace, credential_row.id, p_request_id, 'revoked', caller_id,
    credential_row.label, credential_row.expires_at, credential_row.key_sha256,
    request_hash, receipt_hash
  );

  return jsonb_build_object(
    'status', 'revoked',
    'replay', false,
    'credential_id', credential_row.id,
    'workspace_id', caller_workspace,
    'receipt_sha256', receipt_hash
  );
end;
$$;

create or replace function public.resolve_need_ingress_credential(
  p_key_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  credential_row public.need_ingress_credentials%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_key_sha256 is null or p_key_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'not_found');
  end if;

  perform pg_advisory_xact_lock_shared(560056202607210056::bigint);
  select * into credential_row
    from public.need_ingress_credentials credential
   where credential.key_sha256 = p_key_sha256
     and credential.status = 'active'
     and credential.revoked_at is null
     and credential.expires_at > clock_timestamp()
   for share;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  return jsonb_build_object(
    'status', 'active',
    'credential_id', credential_row.id,
    'workspace_id', credential_row.workspace_id
  );
end;
$$;

create or replace function public.ingest_requisition_with_credential(
  p_credential_id uuid,
  p_key_sha256 text,
  p_source_ref text,
  p_need_content text,
  p_content_type text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  credential_row public.need_ingress_credentials%rowtype;
  derived_source_ref text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_credential_id is null
     or p_key_sha256 is null
     or p_key_sha256 !~ '^[0-9a-f]{64}$'
     or p_source_ref is null
     or p_source_ref !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$' then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  perform pg_advisory_xact_lock_shared(560056202607210056::bigint);
  select * into credential_row
    from public.need_ingress_credentials credential
   where credential.id = p_credential_id
   for update;
  if not found
     or credential_row.key_sha256 is distinct from p_key_sha256
     or credential_row.status <> 'active'
     or credential_row.revoked_at is not null
     or credential_row.expires_at <= clock_timestamp() then
    return jsonb_build_object('status', 'credential_inactive');
  end if;

  derived_source_ref := 'credential:' || credential_row.id::text || ':' || encode(
    sha256(convert_to(p_source_ref, 'UTF8')),
    'hex'
  );
  return public.ingest_requisition_and_enqueue(
    credential_row.workspace_id,
    derived_source_ref,
    p_need_content,
    p_content_type
  );
end;
$$;

alter function public.create_need_ingress_credential(text, text, timestamptz, uuid, uuid)
  owner to postgres;
alter function public.revoke_need_ingress_credential(uuid, uuid, uuid) owner to postgres;
alter function public.resolve_need_ingress_credential(text) owner to postgres;
alter function public.ingest_requisition_with_credential(uuid, text, text, text, text)
  owner to postgres;

revoke all on function public.create_need_ingress_credential(text, text, timestamptz, uuid, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.create_need_ingress_credential(text, text, timestamptz, uuid, uuid)
  to authenticated;

revoke all on function public.revoke_need_ingress_credential(uuid, uuid, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.revoke_need_ingress_credential(uuid, uuid, uuid)
  to authenticated;

revoke all on function public.resolve_need_ingress_credential(text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.resolve_need_ingress_credential(text)
  to service_role;

revoke all on function public.ingest_requisition_with_credential(uuid, text, text, text, text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.ingest_requisition_with_credential(uuid, text, text, text, text)
  to service_role;

-- 0049 accepted a caller-supplied workspace from any service-role caller.
-- Retain it as a postgres-owned internal primitive, but remove its RPC grant.
revoke execute on function public.ingest_requisition_and_enqueue(uuid, text, text, text)
  from service_role;
