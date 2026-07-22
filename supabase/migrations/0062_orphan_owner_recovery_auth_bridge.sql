-- 0062_orphan_owner_recovery_auth_bridge.sql
--
-- Keep the public recovery authority owned by the restricted postgres role,
-- but delegate the bounded auth.users lock and identity decision to the
-- supabase_auth_admin-owned bridge installed during owner reconciliation.

do $aria_orphan_owner_recovery_bridge_precondition$
declare
  recovery_bridge oid :=
    to_regprocedure('auth.aria_orphan_owner_recovery_identity_status(uuid,text,text)');
begin
  if recovery_bridge is null
     or not pg_catalog.has_schema_privilege('postgres', 'auth', 'USAGE')
     or pg_catalog.has_schema_privilege('postgres', 'auth', 'CREATE')
     or not pg_catalog.has_function_privilege('postgres', recovery_bridge, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', recovery_bridge, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticator', recovery_bridge, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', recovery_bridge, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', recovery_bridge, 'EXECUTE')
     or not exists (
       select 1
         from pg_catalog.pg_proc function_definition
         join pg_catalog.pg_roles function_owner
           on function_owner.oid = function_definition.proowner
        where function_definition.oid = recovery_bridge
          and function_owner.rolname = 'supabase_auth_admin'
          and function_definition.prosecdef
          and function_definition.provolatile = 'v'
          and function_definition.proconfig =
            array['search_path=pg_catalog, pg_temp']::text[]
          and not function_definition.proretset
          and function_definition.prorettype =
            'pg_catalog.text'::pg_catalog.regtype
     ) then
    raise exception 'ARIA orphan owner recovery Auth bridge is unavailable or invalid; run owner reconciliation before migrations'
      using errcode = '55000';
  end if;
end
$aria_orphan_owner_recovery_bridge_precondition$;

create or replace function public.recover_orphan_workspace_owner(
  p_workspace_id uuid,
  p_profile_id uuid,
  p_expected_current_domain text,
  p_canonical_email text,
  p_canonical_domain text,
  p_full_name text,
  p_release_sha text,
  p_recovery_receipt_sha256 text,
  p_request_id uuid,
  p_operator_approval text,
  p_operator_approval_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  nil_uuid constant uuid := '00000000-0000-0000-0000-000000000000';
  workspace_record public.workspaces%rowtype;
  profile_record public.profiles%rowtype;
  receipt_record public.owner_recovery_receipts%rowtype;
  state_value jsonb;
  request_hash text;
  email_hash text;
  full_name_hash text;
  state_hash text;
  expected_approval text;
  expected_approval_hash text;
  expected_identity_marker text;
  identity_status text;
  profile_count bigint;
  affected_rows bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_workspace_id is null or p_workspace_id = nil_uuid
     or p_profile_id is null or p_profile_id = nil_uuid
     or p_request_id is null or p_request_id = nil_uuid
     or p_expected_current_domain is distinct from 'workspace'
     or p_canonical_domain is null
     or p_canonical_domain is distinct from btrim(p_canonical_domain)
     or p_canonical_domain is distinct from lower(p_canonical_domain)
     or char_length(p_canonical_domain) not between 1 and 253
     or p_canonical_domain = p_expected_current_domain
     or p_canonical_domain !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$'
     or position('.' in p_canonical_domain) = 0
     or reverse(split_part(reverse(p_canonical_domain), '.', 1)) !~ '[a-z]'
     or p_canonical_email is null
     or p_canonical_email is distinct from btrim(p_canonical_email)
     or p_canonical_email is distinct from lower(p_canonical_email)
     or char_length(p_canonical_email) not between 3 and 254
     or p_canonical_email !~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+$'
     or char_length(p_canonical_email) - char_length(replace(p_canonical_email, '@', '')) <> 1
     or char_length(split_part(p_canonical_email, '@', 1)) not between 1 and 64
     or split_part(p_canonical_email, '@', 2) is distinct from p_canonical_domain
     or p_full_name is null
     or p_full_name is distinct from btrim(p_full_name)
     or char_length(p_full_name) not between 1 and 120
     or p_full_name ~ '[[:cntrl:]]'
     or p_release_sha is null
     or p_release_sha !~ '^[0-9a-f]{40}$'
     or p_recovery_receipt_sha256 is null
     or p_recovery_receipt_sha256 !~ '^[0-9a-f]{64}$'
     or p_operator_approval is null
     or char_length(p_operator_approval) not between 1 and 512
     or p_operator_approval ~ '[[:cntrl:]]'
     or p_operator_approval_sha256 is null
     or p_operator_approval_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  expected_approval := 'aria-owner-recovery-v1:' ||
    p_workspace_id::text || ':' ||
    p_profile_id::text || ':' ||
    p_release_sha || ':' ||
    p_recovery_receipt_sha256 || ':' ||
    p_request_id::text;
  expected_approval_hash := encode(
    digest(convert_to(expected_approval, 'UTF8'), 'sha256'),
    'hex'
  );
  if p_operator_approval is distinct from expected_approval
     or p_operator_approval_sha256 is distinct from expected_approval_hash then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  expected_identity_marker := 'aria-owner-recovery-v1:' ||
    p_request_id::text || ':' || p_operator_approval_sha256;

  request_hash := encode(digest(convert_to(jsonb_build_array(
    'owner-recovery-v1',
    p_workspace_id,
    p_profile_id,
    p_expected_current_domain,
    p_canonical_email,
    p_canonical_domain,
    p_full_name,
    p_release_sha,
    p_recovery_receipt_sha256,
    p_request_id,
    p_operator_approval,
    p_operator_approval_sha256
  )::text, 'UTF8'), 'sha256'), 'hex');

  -- This lock is the CAS serialization point. It also conflicts with a new
  -- profile FK reference to this workspace while the bounded recovery runs.
  select * into workspace_record
    from public.workspaces
   where id = p_workspace_id
   for update;
  if not found then
    return jsonb_build_object('status', 'topology_mismatch');
  end if;

  -- Re-check replay after the workspace lock. A simultaneous exact retry may
  -- have been invisible before waiting for the first transaction to commit.
  select * into receipt_record
    from public.owner_recovery_receipts
   where request_id = p_request_id
   for share;
  if found then
    if receipt_record.request_sha256 = request_hash then
      return jsonb_build_object(
        'status', 'replay',
        'request_id', receipt_record.request_id,
        'workspace_id', receipt_record.workspace_id,
        'profile_id', receipt_record.profile_id,
        'recovered_at', receipt_record.recovered_at
      );
    end if;
    return jsonb_build_object('status', 'idempotency_conflict');
  end if;

  if workspace_record.allowed_domain is distinct from p_expected_current_domain then
    return jsonb_build_object('status', 'topology_mismatch');
  end if;

  select * into profile_record
    from public.profiles
   where id = p_profile_id
   for update;
  if not found
     or profile_record.workspace_id is distinct from p_workspace_id
     or profile_record.role is distinct from 'admin'
     or coalesce(profile_record.email, '') <> '' then
    return jsonb_build_object('status', 'topology_mismatch');
  end if;

  select count(*) into profile_count
    from public.profiles
   where workspace_id = p_workspace_id;
  if profile_count <> 1 then
    return jsonb_build_object('status', 'profile_inventory_mismatch');
  end if;

  select state into state_value
    from public.workspace_state
   where workspace_id = p_workspace_id
   for share;
  if not found then
    return jsonb_build_object('status', 'state_missing');
  end if;
  state_hash := encode(
    digest(convert_to(state_value::text, 'UTF8'), 'sha256'),
    'hex'
  );

  -- The Auth-owner bridge holds its auth.users SHARE/row locks until this
  -- outer recovery transaction ends and returns only a bounded status.
  identity_status := auth.aria_orphan_owner_recovery_identity_status(
    p_profile_id,
    p_canonical_email,
    expected_identity_marker
  );
  case identity_status
    when 'eligible' then
      null;
    when 'auth_inventory_mismatch' then
      return jsonb_build_object('status', 'auth_inventory_mismatch');
    when 'identity_not_eligible' then
      return jsonb_build_object('status', 'identity_not_eligible');
    when 'identity_schema_unsupported' then
      return jsonb_build_object('status', 'identity_schema_unsupported');
    else
      raise exception 'unexpected Auth owner recovery identity status: %',
        coalesce(identity_status, '<null>')
        using errcode = '55000';
  end case;

  if exists (
    select 1 from public.workspaces
     where allowed_domain = p_canonical_domain
       and id <> p_workspace_id
  ) then
    return jsonb_build_object('status', 'domain_conflict');
  end if;

  email_hash := encode(
    digest(convert_to(p_canonical_email, 'UTF8'), 'sha256'),
    'hex'
  );
  full_name_hash := encode(
    digest(convert_to(p_full_name, 'UTF8'), 'sha256'),
    'hex'
  );

  -- Reserve the idempotency identity before business mutation. A request UUID
  -- racing on another workspace therefore conflicts without partial recovery.
  begin
    insert into public.owner_recovery_receipts (
      request_id,
      workspace_id,
      profile_id,
      request_sha256,
      expected_current_domain,
      resulting_domain,
      email_sha256,
      full_name_sha256,
      state_sha256,
      release_sha,
      recovery_receipt_sha256,
      operator_approval,
      operator_approval_sha256
    ) values (
      p_request_id,
      p_workspace_id,
      p_profile_id,
      request_hash,
      p_expected_current_domain,
      p_canonical_domain,
      email_hash,
      full_name_hash,
      state_hash,
      p_release_sha,
      p_recovery_receipt_sha256,
      p_operator_approval,
      p_operator_approval_sha256
    );
  exception when unique_violation then
    select * into receipt_record
      from public.owner_recovery_receipts
     where request_id = p_request_id
     for share;
    if found and receipt_record.request_sha256 = request_hash then
      return jsonb_build_object(
        'status', 'replay',
        'request_id', receipt_record.request_id,
        'workspace_id', receipt_record.workspace_id,
        'profile_id', receipt_record.profile_id,
        'recovered_at', receipt_record.recovered_at
      );
    end if;
    return jsonb_build_object('status', 'idempotency_conflict');
  end;

  update public.workspaces
     set allowed_domain = p_canonical_domain
   where id = p_workspace_id
     and allowed_domain = p_expected_current_domain;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'workspace recovery CAS changed during transaction'
      using errcode = '40001';
  end if;

  update public.profiles
     set email = p_canonical_email,
         full_name = p_full_name
   where id = p_profile_id
     and workspace_id = p_workspace_id
     and role = 'admin'
     and coalesce(email, '') = '';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'profile recovery CAS changed during transaction'
      using errcode = '40001';
  end if;

  if encode(
    digest(convert_to((
      select state::text from public.workspace_state where workspace_id = p_workspace_id
    ), 'UTF8'), 'sha256'),
    'hex'
  ) is distinct from state_hash then
    raise exception 'workspace state changed during owner recovery'
      using errcode = '40001';
  end if;

  return jsonb_build_object(
    'status', 'recovered',
    'request_id', p_request_id,
    'workspace_id', p_workspace_id,
    'profile_id', p_profile_id,
    'state_sha256', state_hash
  );
end;
$$;

alter function public.recover_orphan_workspace_owner(
  uuid, uuid, text, text, text, text, text, text, uuid, text, text
) owner to postgres;
revoke all on function public.recover_orphan_workspace_owner(
  uuid, uuid, text, text, text, text, text, text, uuid, text, text
) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.recover_orphan_workspace_owner(
  uuid, uuid, text, text, text, text, text, text, uuid, text, text
) to service_role;
