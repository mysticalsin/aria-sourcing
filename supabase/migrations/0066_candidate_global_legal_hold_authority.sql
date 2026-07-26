-- 0066_candidate_global_legal_hold_authority.sql
--
-- Candidate erasure is workspace-global. Legal-hold authority must therefore
-- be workspace-and-candidate-global even though each hold and request retains
-- its originating campaign for case traceability.

set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';

create index if not exists candidate_legal_holds_active_candidate_idx
  on public.candidate_legal_holds (
    workspace_id, candidate_id, expires_at, id
  )
  where status = 'active';

create index if not exists candidate_erasure_requests_open_candidate_idx
  on public.candidate_erasure_requests (
    workspace_id, candidate_id, id
  )
  where status <> 'completed';

-- Preserve the exact evidence-bound implementations installed through 0065.
-- A retry sees the predecessors and leaves their definitions untouched.
do $candidate_global_hold_predecessors$
begin
  if to_regprocedure(
    'public.refresh_candidate_erasure_legal_hold_state_pre0066(uuid)'
  ) is null then
    if to_regprocedure(
      'public.refresh_candidate_erasure_legal_hold_state(uuid)'
    ) is null then
      raise exception '0066 requires refresh_candidate_erasure_legal_hold_state(uuid)'
        using errcode = '55000';
    end if;
    alter function public.refresh_candidate_erasure_legal_hold_state(uuid)
      rename to refresh_candidate_erasure_legal_hold_state_pre0066;
  end if;

  if to_regprocedure(
    'public.request_candidate_erasure_pre0066(uuid,uuid,text,text,uuid)'
  ) is null then
    if to_regprocedure(
      'public.request_candidate_erasure(uuid,uuid,text,text,uuid)'
    ) is null then
      raise exception '0066 requires request_candidate_erasure(uuid,uuid,text,text,uuid)'
        using errcode = '55000';
    end if;
    alter function public.request_candidate_erasure(uuid, uuid, text, text, uuid)
      rename to request_candidate_erasure_pre0066;
  end if;

  if to_regprocedure(
    'public.place_candidate_legal_hold_pre0066(uuid,uuid,text,text,text,text,timestamptz)'
  ) is null then
    if to_regprocedure(
      'public.place_candidate_legal_hold(uuid,uuid,text,text,text,text,timestamptz)'
    ) is null then
      raise exception '0066 requires place_candidate_legal_hold(uuid,uuid,text,text,text,text,timestamptz)'
        using errcode = '55000';
    end if;
    alter function public.place_candidate_legal_hold(
      uuid, uuid, text, text, text, text, timestamptz
    ) rename to place_candidate_legal_hold_pre0066;
  end if;

  if to_regprocedure(
    'public.release_candidate_legal_hold_pre0066(uuid,uuid,uuid,text)'
  ) is null then
    if to_regprocedure(
      'public.release_candidate_legal_hold(uuid,uuid,uuid,text)'
    ) is null then
      raise exception '0066 requires release_candidate_legal_hold(uuid,uuid,uuid,text)'
        using errcode = '55000';
    end if;
    alter function public.release_candidate_legal_hold(uuid, uuid, uuid, text)
      rename to release_candidate_legal_hold_pre0066;
  end if;

  if to_regprocedure(
    'public.read_candidate_erasure_obligation_authority_pre0066(uuid,uuid,uuid)'
  ) is null then
    if to_regprocedure(
      'public.read_candidate_erasure_obligation_authority(uuid,uuid,uuid)'
    ) is null then
      raise exception '0066 requires read_candidate_erasure_obligation_authority(uuid,uuid,uuid)'
        using errcode = '55000';
    end if;
    alter function public.read_candidate_erasure_obligation_authority(
      uuid, uuid, uuid
    ) rename to read_candidate_erasure_obligation_authority_pre0066;
  end if;

  if to_regprocedure(
    'public.reconcile_candidate_erasure_obligation_pre0066(uuid,uuid,uuid,integer,text,text,text,text)'
  ) is null then
    if to_regprocedure(
      'public.reconcile_candidate_erasure_obligation(uuid,uuid,uuid,integer,text,text,text,text)'
    ) is null then
      raise exception '0066 requires reconcile_candidate_erasure_obligation(uuid,uuid,uuid,integer,text,text,text,text)'
        using errcode = '55000';
    end if;
    alter function public.reconcile_candidate_erasure_obligation(
      uuid, uuid, uuid, integer, text, text, text, text
    ) rename to reconcile_candidate_erasure_obligation_pre0066;
  end if;
end
$candidate_global_hold_predecessors$;

revoke all on function public.refresh_candidate_erasure_legal_hold_state_pre0066(uuid)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.request_candidate_erasure_pre0066(uuid, uuid, text, text, uuid)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.place_candidate_legal_hold_pre0066(
  uuid, uuid, text, text, text, text, timestamptz
) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.release_candidate_legal_hold_pre0066(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.read_candidate_erasure_obligation_authority_pre0066(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.reconcile_candidate_erasure_obligation_pre0066(
  uuid, uuid, uuid, integer, text, text, text, text
) from public, anon, authenticated, service_role, authenticator;

-- RENAME preserves arbitrary legacy ACL entries. Remove every non-owner
-- executor, including custom roles unknown to this migration; otherwise a
-- historical grant could call the campaign-local predecessor directly.
do $candidate_global_hold_predecessor_acl$
declare
  target_oid oid;
  grant_record record;
begin
  for target_oid in
    select signature::regprocedure::oid
      from unnest(array[
        'public.refresh_candidate_erasure_legal_hold_state_pre0066(uuid)',
        'public.request_candidate_erasure_pre0066(uuid,uuid,text,text,uuid)',
        'public.place_candidate_legal_hold_pre0066(uuid,uuid,text,text,text,text,timestamptz)',
        'public.release_candidate_legal_hold_pre0066(uuid,uuid,uuid,text)',
        'public.read_candidate_erasure_obligation_authority_pre0066(uuid,uuid,uuid)',
        'public.reconcile_candidate_erasure_obligation_pre0066(uuid,uuid,uuid,integer,text,text,text,text)'
      ]) signature
  loop
    for grant_record in
      select acl.grantee,
             case when acl.grantee = 0 then null
                  else pg_get_userbyid(acl.grantee) end role_name
        from pg_proc routine
        cross join lateral aclexplode(
          coalesce(routine.proacl,acldefault('f',routine.proowner))
        ) acl
       where routine.oid = target_oid
         and acl.privilege_type = 'EXECUTE'
         and acl.grantee <> routine.proowner
    loop
      if grant_record.grantee = 0 then
        execute format(
          'revoke execute on function %s from public',
          target_oid::regprocedure
        );
      else
        execute format(
          'revoke execute on function %s from %I',
          target_oid::regprocedure,
          grant_record.role_name
        );
      end if;
    end loop;
  end loop;
end
$candidate_global_hold_predecessor_acl$;

create or replace function public.candidate_legal_hold_lock_key(
  p_workspace_id uuid,
  p_candidate_id text
)
returns integer
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_workspace_id is null
     or p_candidate_id is null
     or p_candidate_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' then
    raise exception 'invalid candidate legal-hold lock subject'
      using errcode = '22023';
  end if;
  return hashtext(p_workspace_id::text || ':' || p_candidate_id);
end;
$$;

revoke all on function public.candidate_legal_hold_lock_key(uuid, text)
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.reconcile_candidate_erasure_legal_hold_scope(
  p_workspace_id uuid,
  p_candidate_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  active_hold boolean;
  wall_now timestamptz;
begin
  if p_workspace_id is null
     or p_candidate_id is null
     or p_candidate_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' then
    raise exception 'invalid candidate legal-hold scope'
      using errcode = '22023';
  end if;

  perform 1
    from public.workspace_state state
   where state.workspace_id = p_workspace_id
   for share;
  if not found then return false; end if;

  perform pg_advisory_xact_lock(
    1095911745,
    public.candidate_legal_hold_lock_key(p_workspace_id, p_candidate_id)
  );

  perform 1
    from public.candidate_legal_holds hold
   where hold.workspace_id = p_workspace_id
     and hold.candidate_id = p_candidate_id
   order by hold.id
   for update;

  perform 1
    from public.candidate_erasure_requests request
   where request.workspace_id = p_workspace_id
     and request.candidate_id = p_candidate_id
     and request.status <> 'completed'
   order by request.id
   for update;

  perform 1
    from public.candidate_erasure_obligations obligation
    join public.candidate_erasure_requests request
      on request.id = obligation.request_id
   where request.workspace_id = p_workspace_id
     and request.candidate_id = p_candidate_id
     and request.status <> 'completed'
   order by obligation.request_id, obligation.id
   for update of obligation;

  wall_now := clock_timestamp();

  update public.candidate_legal_holds hold
     set status = 'expired'
   where hold.workspace_id = p_workspace_id
     and hold.candidate_id = p_candidate_id
     and hold.status = 'active'
     and hold.expires_at is not null
     and hold.expires_at <= wall_now;

  select exists (
    select 1
      from public.candidate_legal_holds hold
     where hold.workspace_id = p_workspace_id
       and hold.candidate_id = p_candidate_id
       and hold.status = 'active'
       and (hold.expires_at is null or hold.expires_at > wall_now)
  ) into active_hold;

  if active_hold then
    update public.candidate_erasure_requests request
       set status = 'blocked_legal_hold',
           updated_at = wall_now
     where request.workspace_id = p_workspace_id
       and request.candidate_id = p_candidate_id
       and request.status <> 'completed'
       and request.status <> 'blocked_legal_hold';

    update public.candidate_erasure_obligations obligation
       set status = 'blocked_legal_hold',
           last_error_code = null,
           next_attempt_at = null,
           updated_at = wall_now
      from public.candidate_erasure_requests request
     where request.id = obligation.request_id
       and request.workspace_id = p_workspace_id
       and request.candidate_id = p_candidate_id
       and request.status <> 'completed'
       and obligation.status <> 'completed'
       and obligation.status <> 'blocked_legal_hold';
  else
    update public.candidate_erasure_obligations obligation
       set status = 'manual_required',
           last_error_code = null,
           next_attempt_at = null,
           updated_at = wall_now
      from public.candidate_erasure_requests request
     where request.id = obligation.request_id
       and request.workspace_id = p_workspace_id
       and request.candidate_id = p_candidate_id
       and request.status = 'blocked_legal_hold'
       and request.local_scrub_completed_at is not null
       and obligation.status = 'blocked_legal_hold';

    update public.candidate_erasure_requests request
       set status = 'manual_required',
           updated_at = wall_now
     where request.workspace_id = p_workspace_id
       and request.candidate_id = p_candidate_id
       and request.status = 'blocked_legal_hold'
       and request.local_scrub_completed_at is not null;
  end if;

  return active_hold;
end;
$$;

revoke all on function public.reconcile_candidate_erasure_legal_hold_scope(uuid, text)
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.refresh_candidate_erasure_legal_hold_state(
  p_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  request_record public.candidate_erasure_requests%rowtype;
begin
  select * into request_record
    from public.candidate_erasure_requests request
   where request.id = p_request_id;
  if not found then return false; end if;

  perform 1
    from public.workspace_state state
   where state.workspace_id = request_record.workspace_id
   for share;
  if not found then return false; end if;

  perform pg_advisory_xact_lock(
    1095911745,
    public.candidate_legal_hold_lock_key(
      request_record.workspace_id, request_record.candidate_id
    )
  );
  return public.reconcile_candidate_erasure_legal_hold_scope(
    request_record.workspace_id, request_record.candidate_id
  );
end;
$$;

revoke all on function public.refresh_candidate_erasure_legal_hold_state(uuid)
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.list_candidate_erasure_requests(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  result jsonb;
  candidate_record record;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'invalid candidate erasure queue limit'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
      from public.profiles profile
     where profile.workspace_id = p_workspace_id
       and profile.id = p_actor_id
       and profile.role = 'admin'
     for key share
  ) then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;

  perform 1
    from public.workspace_state state
   where state.workspace_id = p_workspace_id
   for share;
  if not found then return '[]'::jsonb; end if;

  -- Transaction advisory locks persist until commit. Acquire the bounded
  -- candidate set in the same total order as retention so two multi-candidate
  -- calls cannot form an A->B / B->A wait cycle.
  for candidate_record in
    select target.candidate_id,target.lock_key
      from (
        select distinct selected.candidate_id,
               public.candidate_legal_hold_lock_key(
                 p_workspace_id,selected.candidate_id
               ) lock_key
          from (
            select request.candidate_id
              from public.candidate_erasure_requests request
             where request.workspace_id = p_workspace_id
               and request.status = 'blocked_legal_hold'
             order by request.updated_at,request.id
             limit p_limit
          ) selected
      ) target
     order by target.lock_key,target.candidate_id
  loop
    perform pg_advisory_xact_lock(1095911745,candidate_record.lock_key);
    perform public.reconcile_candidate_erasure_legal_hold_scope(
      p_workspace_id,candidate_record.candidate_id
    );
  end loop;

  select coalesce(jsonb_agg(
    public.candidate_erasure_response(request.id,false)
    order by request.updated_at,request.id
  ),'[]'::jsonb)
    into result
    from (
      select item.id,item.updated_at
        from public.candidate_erasure_requests item
       where item.workspace_id = p_workspace_id
         and item.status <> 'completed'
       order by item.updated_at,item.id
       limit p_limit
    ) request;
  return result;
end;
$$;

revoke all on function public.list_candidate_erasure_requests(uuid,uuid,integer)
  from public,anon,authenticated,service_role,authenticator;
grant execute on function public.list_candidate_erasure_requests(uuid,uuid,integer)
  to service_role;

create or replace function public.request_candidate_erasure(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_campaign_id text,
  p_candidate_id text,
  p_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  workspace_record public.workspace_state%rowtype;
  request_record public.candidate_erasure_requests%rowtype;
  candidate_count integer;
  active_hold boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_actor_id is null or p_request_key is null
     or p_campaign_id is null
     or p_campaign_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     or p_candidate_id is null
     or p_candidate_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' then
    raise exception 'invalid candidate erasure request' using errcode = '22023';
  end if;
  if not exists (
    select 1
      from public.profiles profile
     where profile.workspace_id = p_workspace_id
       and profile.id = p_actor_id
       and profile.role = 'admin'
     for key share
  ) then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;

  select * into workspace_record
    from public.workspace_state state
   where state.workspace_id = p_workspace_id
   for update;
  if not found or jsonb_typeof(workspace_record.state -> 'candidates') <> 'array' then
    return jsonb_build_object('status', 'not_found');
  end if;

  perform pg_advisory_xact_lock(
    1095911745,
    public.candidate_legal_hold_lock_key(p_workspace_id, p_candidate_id)
  );
  active_hold := public.reconcile_candidate_erasure_legal_hold_scope(
    p_workspace_id, p_candidate_id
  );

  select * into request_record
    from public.candidate_erasure_requests request
   where request.workspace_id = p_workspace_id
     and request.request_key = p_request_key
   for update;
  if found then
    if request_record.actor_id <> p_actor_id
       or request_record.campaign_id <> p_campaign_id
       or request_record.candidate_id <> p_candidate_id then
      return jsonb_build_object('status', 'idempotency_conflict');
    end if;
    if active_hold then
      return public.candidate_erasure_response(request_record.id, true);
    end if;
    return public.request_candidate_erasure_pre0066(
      p_workspace_id, p_actor_id, p_campaign_id, p_candidate_id, p_request_key
    );
  end if;

  select count(*) into candidate_count
    from jsonb_array_elements(workspace_record.state -> 'candidates') item(value)
   where item.value ->> 'id' = p_candidate_id
     and item.value ->> 'campaignId' = p_campaign_id;
  if candidate_count = 0 then
    return jsonb_build_object('status', 'not_found');
  end if;
  if candidate_count <> 1 then
    raise exception 'candidate erasure canonical identity is ambiguous'
      using errcode = '55000';
  end if;

  if active_hold then
    select * into request_record
      from public.candidate_erasure_requests request
     where request.workspace_id = p_workspace_id
       and request.campaign_id = p_campaign_id
       and request.candidate_id = p_candidate_id
     for update;
    if found then
      return public.candidate_erasure_response(request_record.id, true);
    end if;

    insert into public.candidate_erasure_requests(
      workspace_id, campaign_id, candidate_id, actor_id, request_key, status
    ) values (
      p_workspace_id, p_campaign_id, p_candidate_id, p_actor_id,
      p_request_key, 'blocked_legal_hold'
    ) returning * into request_record;
    return public.candidate_erasure_response(request_record.id, false);
  end if;

  return public.request_candidate_erasure_pre0066(
    p_workspace_id, p_actor_id, p_campaign_id, p_candidate_id, p_request_key
  );
end;
$$;

revoke all on function public.request_candidate_erasure(uuid, uuid, text, text, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.request_candidate_erasure(uuid, uuid, text, text, uuid)
  to service_role;

create or replace function public.place_candidate_legal_hold(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_campaign_id text,
  p_candidate_id text,
  p_reason_code text,
  p_case_reference text,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  workspace_record public.workspace_state%rowtype;
  candidate_count integer;
  result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_actor_id is null
     or p_campaign_id is null
     or p_campaign_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     or p_candidate_id is null
     or p_candidate_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     or p_reason_code is null
     or p_reason_code !~ '^[A-Z][A-Z0-9_]{1,63}$'
     or p_case_reference is null
     or p_case_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$'
     or (p_expires_at is not null and p_expires_at <= now()) then
    raise exception 'invalid legal hold' using errcode = '22023';
  end if;
  if not exists (
    select 1
      from public.profiles profile
     where profile.workspace_id = p_workspace_id
       and profile.id = p_actor_id
       and profile.role = 'admin'
     for key share
  ) then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;

  select * into workspace_record
    from public.workspace_state state
   where state.workspace_id = p_workspace_id
   for share;
  if not found or jsonb_typeof(workspace_record.state -> 'candidates') <> 'array' then
    return jsonb_build_object('status', 'not_found');
  end if;
  select count(*) into candidate_count
    from jsonb_array_elements(workspace_record.state -> 'candidates') item(value)
   where item.value ->> 'id' = p_candidate_id
     and item.value ->> 'campaignId' = p_campaign_id;
  if candidate_count = 0 then
    return jsonb_build_object('status', 'not_found');
  end if;
  if candidate_count <> 1 then
    raise exception 'candidate legal-hold canonical identity is ambiguous'
      using errcode = '55000';
  end if;

  perform pg_advisory_xact_lock(
    1095911745,
    public.candidate_legal_hold_lock_key(p_workspace_id, p_candidate_id)
  );
  if p_expires_at is not null and p_expires_at <= clock_timestamp() then
    raise exception 'invalid legal hold' using errcode = '22023';
  end if;
  result := public.place_candidate_legal_hold_pre0066(
    p_workspace_id, p_actor_id, p_campaign_id, p_candidate_id,
    p_reason_code, p_case_reference, p_expires_at
  );
  perform public.reconcile_candidate_erasure_legal_hold_scope(
    p_workspace_id, p_candidate_id
  );
  if result ->> 'status' = 'active'
     and exists (
       select 1
         from public.candidate_legal_holds hold
        where hold.id = (result ->> 'hold_id')::uuid
          and hold.status <> 'active'
     ) then
    raise exception 'legal hold expired before placement completed'
      using errcode = '22023';
  end if;
  return result;
end;
$$;

revoke all on function public.place_candidate_legal_hold(
  uuid, uuid, text, text, text, text, timestamptz
) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.place_candidate_legal_hold(
  uuid, uuid, text, text, text, text, timestamptz
) to service_role;

create or replace function public.release_candidate_legal_hold(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_hold_id uuid,
  p_case_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  hold_record public.candidate_legal_holds%rowtype;
  workspace_present boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_actor_id is null or p_hold_id is null
     or p_case_reference is null
     or p_case_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$' then
    raise exception 'invalid legal hold release' using errcode = '22023';
  end if;
  if not exists (
    select 1
      from public.profiles profile
     where profile.workspace_id = p_workspace_id
       and profile.id = p_actor_id
       and profile.role = 'admin'
     for key share
  ) then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;

  select true into workspace_present
    from public.workspace_state state
   where state.workspace_id = p_workspace_id
   for share;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  select * into hold_record
    from public.candidate_legal_holds hold
   where hold.id = p_hold_id
     and hold.workspace_id = p_workspace_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  perform pg_advisory_xact_lock(
    1095911745,
    public.candidate_legal_hold_lock_key(
      hold_record.workspace_id, hold_record.candidate_id
    )
  );
  perform public.reconcile_candidate_erasure_legal_hold_scope(
    hold_record.workspace_id, hold_record.candidate_id
  );

  select * into hold_record
    from public.candidate_legal_holds hold
   where hold.id = p_hold_id
     and hold.workspace_id = p_workspace_id
   for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  if hold_record.status = 'released' then
    if hold_record.released_by <> p_actor_id
       or hold_record.release_case_reference <> p_case_reference then
      return jsonb_build_object(
        'status', 'conflict', 'hold_id', hold_record.id, 'replayed', false
      );
    end if;
    return jsonb_build_object(
      'status', 'released', 'hold_id', hold_record.id, 'replayed', true
    );
  end if;
  if hold_record.status = 'expired' then
    return jsonb_build_object(
      'status', 'conflict', 'hold_id', hold_record.id, 'replayed', false
    );
  end if;

  update public.candidate_legal_holds hold
     set status = 'released',
         released_by = p_actor_id,
         released_at = clock_timestamp(),
         release_case_reference = p_case_reference
   where hold.id = hold_record.id;

  perform public.reconcile_candidate_erasure_legal_hold_scope(
    hold_record.workspace_id, hold_record.candidate_id
  );
  return jsonb_build_object(
    'status', 'released', 'hold_id', hold_record.id, 'replayed', false
  );
end;
$$;

revoke all on function public.release_candidate_legal_hold(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.release_candidate_legal_hold(uuid, uuid, uuid, text)
  to service_role;

create or replace function public.read_candidate_erasure_obligation_authority(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_obligation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  obligation_record public.candidate_erasure_obligations%rowtype;
  request_record public.candidate_erasure_requests%rowtype;
  workspace_present boolean;
  active_hold boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_actor_id is null or p_obligation_id is null then
    raise exception 'invalid candidate erasure authority request'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
      from public.profiles profile
     where profile.workspace_id = p_workspace_id
       and profile.id = p_actor_id
       and profile.role = 'admin'
     for key share
  ) then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;

  select true into workspace_present
    from public.workspace_state state
   where state.workspace_id = p_workspace_id
   for share;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  select * into obligation_record
    from public.candidate_erasure_obligations obligation
   where obligation.id = p_obligation_id
     and obligation.workspace_id = p_workspace_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select * into request_record
    from public.candidate_erasure_requests request
   where request.id = obligation_record.request_id
     and request.workspace_id = p_workspace_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  perform pg_advisory_xact_lock(
    1095911745,
    public.candidate_legal_hold_lock_key(
      request_record.workspace_id, request_record.candidate_id
    )
  );
  active_hold := public.reconcile_candidate_erasure_legal_hold_scope(
    request_record.workspace_id, request_record.candidate_id
  );

  select * into obligation_record
    from public.candidate_erasure_obligations obligation
   where obligation.id = p_obligation_id
     and obligation.workspace_id = p_workspace_id
   for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if active_hold and obligation_record.status <> 'completed' then
    return jsonb_build_object(
      'status', 'blocked_legal_hold',
      'obligation_id', obligation_record.id,
      'provider', obligation_record.provider,
      'attempt_count', obligation_record.attempt_count
    );
  end if;

  return public.read_candidate_erasure_obligation_authority_pre0066(
    p_workspace_id, p_actor_id, p_obligation_id
  );
end;
$$;

revoke all on function public.read_candidate_erasure_obligation_authority(uuid, uuid, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.read_candidate_erasure_obligation_authority(uuid, uuid, uuid)
  to service_role;

create or replace function public.reconcile_candidate_erasure_obligation(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_obligation_id uuid,
  p_expected_attempt_count integer,
  p_status text,
  p_error_code text default null,
  p_evidence_sha256 text default null,
  p_case_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  obligation_record public.candidate_erasure_obligations%rowtype;
  request_record public.candidate_erasure_requests%rowtype;
  workspace_present boolean;
  active_hold boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_actor_id is null or p_obligation_id is null
     or p_expected_attempt_count is null or p_expected_attempt_count < 0
     or p_status not in ('pending_provider', 'retryable_failure', 'completed')
     or (p_status = 'retryable_failure' and (
       p_error_code is null or p_error_code !~ '^[A-Z][A-Z0-9_]{1,63}$'
     ))
     or (p_status <> 'retryable_failure' and p_error_code is not null)
     or (p_status = 'completed' and (
       p_evidence_sha256 is null or p_evidence_sha256 !~ '^[0-9a-f]{64}$'
       or p_case_reference is null
       or p_case_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$'
     ))
     or (p_status <> 'completed' and (
       p_evidence_sha256 is not null or p_case_reference is not null
     )) then
    raise exception 'invalid obligation transition' using errcode = '22023';
  end if;
  if not exists (
    select 1
      from public.profiles profile
     where profile.workspace_id = p_workspace_id
       and profile.id = p_actor_id
       and profile.role = 'admin'
     for key share
  ) then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;

  select true into workspace_present
    from public.workspace_state state
   where state.workspace_id = p_workspace_id
   for share;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  select * into obligation_record
    from public.candidate_erasure_obligations obligation
   where obligation.id = p_obligation_id
     and obligation.workspace_id = p_workspace_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select * into request_record
    from public.candidate_erasure_requests request
   where request.id = obligation_record.request_id
     and request.workspace_id = p_workspace_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  perform pg_advisory_xact_lock(
    1095911745,
    public.candidate_legal_hold_lock_key(
      request_record.workspace_id, request_record.candidate_id
    )
  );
  active_hold := public.reconcile_candidate_erasure_legal_hold_scope(
    request_record.workspace_id, request_record.candidate_id
  );

  select * into obligation_record
    from public.candidate_erasure_obligations obligation
   where obligation.id = p_obligation_id
     and obligation.workspace_id = p_workspace_id
   for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if active_hold and obligation_record.status <> 'completed' then
    return jsonb_build_object(
      'status', 'blocked_legal_hold',
      'obligation_id', obligation_record.id,
      'attempt_count', obligation_record.attempt_count
    );
  end if;

  return public.reconcile_candidate_erasure_obligation_pre0066(
    p_workspace_id, p_actor_id, p_obligation_id, p_expected_attempt_count,
    p_status, p_error_code, p_evidence_sha256, p_case_reference
  );
end;
$$;

revoke all on function public.reconcile_candidate_erasure_obligation(
  uuid, uuid, uuid, integer, text, text, text, text
) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.reconcile_candidate_erasure_obligation(
  uuid, uuid, uuid, integer, text, text, text, text
) to service_role;

-- Retention acquires the same candidate-global scope before removing expired
-- evidence. A held evidence row also protects its linked staged provider
-- payload; unrelated expired rows continue to be removed within the bound.
create or replace function public.cleanup_autonomous_web_sourcing_retention(
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  evidence_record record;
  stage_record record;
  candidate_record record;
  workspace_record record;
  evidence_targets jsonb;
  stage_targets jsonb;
  candidate_targets jsonb;
  workspace_targets jsonb;
  target_limit integer;
  active_hold boolean;
  stage_protected boolean;
  deleted_rows integer;
  staged_deleted integer := 0;
  evidence_deleted integer := 0;
  quota_deleted integer := 0;
  metadata_deleted integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 5000 then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  -- One provider attempt contains at most five evidence candidates. Capping
  -- each of the evidence and stage target sets at 80 therefore bounds retained
  -- advisory locks to at most 480 candidate scopes while allowing callers to
  -- request a larger maintenance sweep across repeated transactions.
  target_limit := least(p_limit,80);

  perform set_config('aria.autonomous_web_payload_cleanup', 'on', true);
  perform set_config('aria.autonomous_web_retention_cleanup', 'on', true);

  -- Snapshot the exact bounded rows first. All workspace rows are locked
  -- before any candidate advisory lock, then every candidate scope is acquired
  -- in one total order shared with list_candidate_erasure_requests.
  with evidence_target as materialized (
    select evidence.workspace_id,evidence.campaign_id,evidence.candidate_id,
           evidence.egress_attempt_id
      from public.autonomous_web_candidate_evidence evidence
     where evidence.expires_at <= clock_timestamp()
     order by evidence.expires_at,evidence.workspace_id,
              evidence.candidate_id,evidence.campaign_id
     limit target_limit
  ), stage_target as materialized (
    select stage.workspace_id,stage.egress_attempt_id
      from public.autonomous_web_sourcing_staged_results stage
     where stage.expires_at <= clock_timestamp()
     order by stage.expires_at,stage.workspace_id,stage.egress_attempt_id
     limit target_limit
  ), candidate_target as materialized (
    select evidence.workspace_id,evidence.candidate_id
      from evidence_target evidence
    union
    select evidence.workspace_id,evidence.candidate_id
      from public.autonomous_web_candidate_evidence evidence
      join stage_target stage
        on stage.workspace_id = evidence.workspace_id
       and stage.egress_attempt_id = evidence.egress_attempt_id
  ), workspace_target as materialized (
    select evidence.workspace_id from evidence_target evidence
    union
    select stage.workspace_id from stage_target stage
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'workspace_id',target.workspace_id,
        'campaign_id',target.campaign_id,
        'candidate_id',target.candidate_id,
        'egress_attempt_id',target.egress_attempt_id
      ) order by target.workspace_id,target.candidate_id,
                 target.campaign_id,target.egress_attempt_id)
        from evidence_target target
    ),'[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'workspace_id',target.workspace_id,
        'egress_attempt_id',target.egress_attempt_id
      ) order by target.workspace_id,target.egress_attempt_id)
        from stage_target target
    ),'[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'workspace_id',target.workspace_id,
        'candidate_id',target.candidate_id,
        'lock_key',public.candidate_legal_hold_lock_key(
          target.workspace_id,target.candidate_id
        )
      ) order by target.workspace_id,
                 public.candidate_legal_hold_lock_key(
                   target.workspace_id,target.candidate_id
                 ),target.candidate_id)
        from candidate_target target
    ),'[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('workspace_id',target.workspace_id)
                       order by target.workspace_id)
        from workspace_target target
    ),'[]'::jsonb)
    into evidence_targets,stage_targets,candidate_targets,workspace_targets;

  for workspace_record in
    select (item.value ->> 'workspace_id')::uuid workspace_id
      from jsonb_array_elements(workspace_targets) item(value)
     order by workspace_id
  loop
    perform 1
      from public.workspace_state state
     where state.workspace_id = workspace_record.workspace_id
     for share;
  end loop;

  for candidate_record in
    select (item.value ->> 'workspace_id')::uuid workspace_id,
           item.value ->> 'candidate_id' candidate_id,
           (item.value ->> 'lock_key')::integer lock_key
      from jsonb_array_elements(candidate_targets) item(value)
     order by workspace_id,lock_key,candidate_id
  loop
    perform pg_advisory_xact_lock(1095911745,candidate_record.lock_key);
    perform public.reconcile_candidate_erasure_legal_hold_scope(
      candidate_record.workspace_id,candidate_record.candidate_id
    );
  end loop;

  for evidence_record in
    select (item.value ->> 'workspace_id')::uuid workspace_id,
           (item.value ->> 'campaign_id')::uuid campaign_id,
           item.value ->> 'candidate_id' candidate_id,
           (item.value ->> 'egress_attempt_id')::uuid egress_attempt_id
      from jsonb_array_elements(evidence_targets) item(value)
  loop
    active_hold := public.reconcile_candidate_erasure_legal_hold_scope(
      evidence_record.workspace_id,evidence_record.candidate_id
    );
    if not active_hold then
      delete from public.autonomous_web_candidate_evidence evidence
       where evidence.workspace_id = evidence_record.workspace_id
         and evidence.campaign_id = evidence_record.campaign_id
         and evidence.candidate_id = evidence_record.candidate_id
         and evidence.egress_attempt_id = evidence_record.egress_attempt_id
         and evidence.expires_at <= clock_timestamp();
      get diagnostics deleted_rows = row_count;
      evidence_deleted := evidence_deleted + deleted_rows;
    end if;
  end loop;

  for stage_record in
    select (item.value ->> 'workspace_id')::uuid workspace_id,
           (item.value ->> 'egress_attempt_id')::uuid egress_attempt_id
      from jsonb_array_elements(stage_targets) item(value)
  loop
    select exists (
      select 1
        from public.autonomous_web_candidate_evidence evidence
        join public.candidate_legal_holds hold
          on hold.workspace_id = evidence.workspace_id
         and hold.candidate_id = evidence.candidate_id
       where evidence.workspace_id = stage_record.workspace_id
         and evidence.egress_attempt_id = stage_record.egress_attempt_id
         and hold.status = 'active'
         and (hold.expires_at is null or hold.expires_at > clock_timestamp())
    ) into stage_protected;

    if not stage_protected then
      delete from public.autonomous_web_sourcing_staged_results stage
       where stage.workspace_id = stage_record.workspace_id
         and stage.egress_attempt_id = stage_record.egress_attempt_id
         and stage.expires_at <= clock_timestamp();
      get diagnostics deleted_rows = row_count;
      staged_deleted := staged_deleted + deleted_rows;
    end if;
  end loop;

  delete from public.autonomous_web_sourcing_quota_ledger quota
   where quota.id in (
     select candidate.id
       from public.autonomous_web_sourcing_quota_ledger candidate
      where candidate.recorded_at < clock_timestamp() - interval '2 days'
      order by candidate.id
      limit p_limit
   );
  get diagnostics quota_deleted = row_count;

  delete from public.autonomous_web_sourcing_reconciliations row_to_delete
   where row_to_delete.egress_attempt_id in (
     select attempt.id
       from public.autonomous_web_sourcing_attempts attempt
       join public.aria_jobs job on job.id = attempt.job_id
      where attempt.begun_at < clock_timestamp() - interval '180 days'
        and job.status in ('succeeded', 'dead')
        and not exists (
          select 1 from public.autonomous_web_candidate_evidence evidence
           where evidence.egress_attempt_id = attempt.id
        )
      order by attempt.begun_at, attempt.id
      limit p_limit
   );
  delete from public.autonomous_web_sourcing_receipts row_to_delete
   where row_to_delete.egress_attempt_id in (
     select attempt.id
       from public.autonomous_web_sourcing_attempts attempt
       join public.aria_jobs job on job.id = attempt.job_id
      where attempt.begun_at < clock_timestamp() - interval '180 days'
        and job.status in ('succeeded', 'dead')
        and not exists (
          select 1 from public.autonomous_web_candidate_evidence evidence
           where evidence.egress_attempt_id = attempt.id
        )
      order by attempt.begun_at, attempt.id
      limit p_limit
   );
  delete from public.autonomous_web_sourcing_failures row_to_delete
   where row_to_delete.egress_attempt_id in (
     select attempt.id
       from public.autonomous_web_sourcing_attempts attempt
       join public.aria_jobs job on job.id = attempt.job_id
      where attempt.begun_at < clock_timestamp() - interval '180 days'
        and job.status in ('succeeded', 'dead')
        and not exists (
          select 1 from public.autonomous_web_candidate_evidence evidence
           where evidence.egress_attempt_id = attempt.id
        )
      order by attempt.begun_at, attempt.id
      limit p_limit
   );
  delete from public.autonomous_web_sourcing_results row_to_delete
   where row_to_delete.egress_attempt_id in (
     select attempt.id
       from public.autonomous_web_sourcing_attempts attempt
       join public.aria_jobs job on job.id = attempt.job_id
      where attempt.begun_at < clock_timestamp() - interval '180 days'
        and job.status in ('succeeded', 'dead')
        and not exists (
          select 1 from public.autonomous_web_candidate_evidence evidence
           where evidence.egress_attempt_id = attempt.id
        )
      order by attempt.begun_at, attempt.id
      limit p_limit
   );
  delete from public.autonomous_web_sourcing_confirmations row_to_delete
   where row_to_delete.egress_attempt_id in (
     select attempt.id
       from public.autonomous_web_sourcing_attempts attempt
       join public.aria_jobs job on job.id = attempt.job_id
      where attempt.begun_at < clock_timestamp() - interval '180 days'
        and job.status in ('succeeded', 'dead')
        and not exists (
          select 1 from public.autonomous_web_candidate_evidence evidence
           where evidence.egress_attempt_id = attempt.id
        )
      order by attempt.begun_at, attempt.id
      limit p_limit
   );
  delete from public.autonomous_web_sourcing_attempts attempt
   where attempt.id in (
     select candidate.id
       from public.autonomous_web_sourcing_attempts candidate
       join public.aria_jobs job on job.id = candidate.job_id
      where candidate.begun_at < clock_timestamp() - interval '180 days'
        and job.status in ('succeeded', 'dead')
        and not exists (
          select 1 from public.autonomous_web_candidate_evidence evidence
           where evidence.egress_attempt_id = candidate.id
        )
      order by candidate.begun_at, candidate.id
      limit p_limit
   );
  get diagnostics metadata_deleted = row_count;
  delete from public.autonomous_web_sourcing_claims claim
   where (claim.job_id, claim.fence_version) in (
     select candidate.job_id, candidate.fence_version
       from public.autonomous_web_sourcing_claims candidate
       join public.aria_jobs job on job.id = candidate.job_id
      where candidate.authorized_at < clock_timestamp() - interval '180 days'
        and job.status in ('succeeded', 'dead')
        and not exists (
          select 1
            from public.autonomous_web_sourcing_attempts attempt
           where attempt.job_id = candidate.job_id
             and attempt.claim_token = candidate.claim_token
             and attempt.fence_version = candidate.fence_version
        )
      order by candidate.authorized_at, candidate.job_id,
               candidate.fence_version
      limit p_limit
   );

  return jsonb_build_object(
    'status', 'completed',
    'stagedDeleted', staged_deleted,
    'evidenceDeleted', evidence_deleted,
    'quotaDeleted', quota_deleted,
    'metadataDeleted', metadata_deleted
  );
end;
$$;

revoke all on function public.cleanup_autonomous_web_sourcing_retention(integer)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.cleanup_autonomous_web_sourcing_retention(integer)
  to service_role;

alter function public.candidate_legal_hold_lock_key(uuid, text)
  owner to postgres;
alter function public.reconcile_candidate_erasure_legal_hold_scope(uuid, text)
  owner to postgres;
alter function public.refresh_candidate_erasure_legal_hold_state(uuid)
  owner to postgres;
alter function public.refresh_candidate_erasure_legal_hold_state_pre0066(uuid)
  owner to postgres;
alter function public.list_candidate_erasure_requests(uuid, uuid, integer)
  owner to postgres;
alter function public.request_candidate_erasure(uuid, uuid, text, text, uuid)
  owner to postgres;
alter function public.request_candidate_erasure_pre0066(uuid, uuid, text, text, uuid)
  owner to postgres;
alter function public.place_candidate_legal_hold(
  uuid, uuid, text, text, text, text, timestamptz
) owner to postgres;
alter function public.place_candidate_legal_hold_pre0066(
  uuid, uuid, text, text, text, text, timestamptz
) owner to postgres;
alter function public.release_candidate_legal_hold(uuid, uuid, uuid, text)
  owner to postgres;
alter function public.release_candidate_legal_hold_pre0066(uuid, uuid, uuid, text)
  owner to postgres;
alter function public.read_candidate_erasure_obligation_authority(uuid, uuid, uuid)
  owner to postgres;
alter function public.read_candidate_erasure_obligation_authority_pre0066(
  uuid, uuid, uuid
) owner to postgres;
alter function public.reconcile_candidate_erasure_obligation(
  uuid, uuid, uuid, integer, text, text, text, text
) owner to postgres;
alter function public.reconcile_candidate_erasure_obligation_pre0066(
  uuid, uuid, uuid, integer, text, text, text, text
) owner to postgres;
alter function public.cleanup_autonomous_web_sourcing_retention(integer)
  owner to postgres;

-- A retry must also remove grants added after an earlier partial/ambiguous
-- apply. Keep exactly service_role on the runtime wrappers and no non-owner
-- executor on helpers or predecessors.
do $candidate_global_hold_exact_acl$
declare
  target_record record;
  grant_record record;
begin
  for target_record in
    select target.signature::regprocedure::oid routine_oid,
           target.allowed_role
      from (values
        ('public.candidate_legal_hold_lock_key(uuid,text)',null::text),
        ('public.reconcile_candidate_erasure_legal_hold_scope(uuid,text)',null::text),
        ('public.refresh_candidate_erasure_legal_hold_state_pre0066(uuid)',null::text),
        ('public.request_candidate_erasure_pre0066(uuid,uuid,text,text,uuid)',null::text),
        ('public.place_candidate_legal_hold_pre0066(uuid,uuid,text,text,text,text,timestamptz)',null::text),
        ('public.release_candidate_legal_hold_pre0066(uuid,uuid,uuid,text)',null::text),
        ('public.read_candidate_erasure_obligation_authority_pre0066(uuid,uuid,uuid)',null::text),
        ('public.reconcile_candidate_erasure_obligation_pre0066(uuid,uuid,uuid,integer,text,text,text,text)',null::text),
        ('public.refresh_candidate_erasure_legal_hold_state(uuid)',null::text),
        ('public.list_candidate_erasure_requests(uuid,uuid,integer)','service_role'),
        ('public.request_candidate_erasure(uuid,uuid,text,text,uuid)','service_role'),
        ('public.place_candidate_legal_hold(uuid,uuid,text,text,text,text,timestamptz)','service_role'),
        ('public.release_candidate_legal_hold(uuid,uuid,uuid,text)','service_role'),
        ('public.read_candidate_erasure_obligation_authority(uuid,uuid,uuid)','service_role'),
        ('public.reconcile_candidate_erasure_obligation(uuid,uuid,uuid,integer,text,text,text,text)','service_role'),
        ('public.cleanup_autonomous_web_sourcing_retention(integer)','service_role')
      ) target(signature,allowed_role)
  loop
    for grant_record in
      select acl.grantee,
             case when acl.grantee = 0 then null
                  else pg_get_userbyid(acl.grantee) end role_name
        from pg_proc routine
        cross join lateral aclexplode(
          coalesce(routine.proacl,acldefault('f',routine.proowner))
        ) acl
       where routine.oid = target_record.routine_oid
         and acl.privilege_type = 'EXECUTE'
         and acl.grantee <> routine.proowner
         and (
           acl.grantee = 0
           or target_record.allowed_role is null
           or pg_get_userbyid(acl.grantee) <> target_record.allowed_role
         )
    loop
      if grant_record.grantee = 0 then
        execute format(
          'revoke execute on function %s from public',
          target_record.routine_oid::regprocedure
        );
      else
        execute format(
          'revoke execute on function %s from %I',
          target_record.routine_oid::regprocedure,
          grant_record.role_name
        );
      end if;
    end loop;
  end loop;
end
$candidate_global_hold_exact_acl$;
